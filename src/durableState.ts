import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import writeFileAtomic, { sync as writeFileAtomicSync } from 'write-file-atomic';

import type { AtomicPersistenceResult, PersistenceFailure } from './contracts/persistence.ts';

interface AtomicWriteOptions {
  backup?: boolean;
  backupPath?: string;
  mode?: number;
}

interface AsyncAtomicWriteOptions extends AtomicWriteOptions {
  durable?: boolean;
}

interface JsonWriteOptions extends AtomicWriteOptions {
  spacing?: number;
}

interface AsyncJsonWriteOptions extends AsyncAtomicWriteOptions {
  spacing?: number;
}

interface RecoveryDetails {
  path: string;
  backupPath: string;
  reason: string;
}

interface JsonReadOptions<T> extends AtomicWriteOptions {
  fallback?: T;
  onRecovery?: (details: RecoveryDetails) => void;
  restoreBackup?: boolean;
  validate?: (value: unknown) => boolean;
}

interface ParseSuccess {
  ok: true;
  missing: false;
  value: unknown;
}

interface ParseFailure {
  ok: false;
  missing: boolean;
  reason: string;
  error?: unknown;
}

type ParseResult = ParseSuccess | ParseFailure;

const asyncWriteQueues = new Map<string, Promise<unknown>>();

class DurableStateError extends Error implements PersistenceFailure {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'DurableStateError';
    this.code = code;
    this.details = details;
  }
}

function writeTextAtomic(target: unknown, text: unknown, options: AtomicWriteOptions = {}): AtomicPersistenceResult {
  const file = path.resolve(String(target));
  const directory = path.dirname(file);
  const mode = options.mode ?? 0o600;
  const backup = options.backup === true ? path.resolve(String(options.backupPath || `${file}.bak`)) : '';
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (backup && fs.existsSync(file)) {
      writeFileAtomicSync(backup, fs.readFileSync(file), { fsync: true, mode });
    }
    writeFileAtomicSync(file, String(text), { encoding: 'utf8', fsync: true, mode });
    syncDirectory(directory);
    return { path: file, backupPath: backup || null };
  } catch (error) {
    throw new DurableStateError(
      'DURABLE_STATE_WRITE_FAILED',
      `Could not persist state file ${path.basename(file)}.`,
      { path: file, fsCode: errorCode(error) },
      { cause: error }
    );
  }
}

function writeJsonAtomic(target: unknown, value: unknown, options: JsonWriteOptions = {}): AtomicPersistenceResult {
  const spacing = Number.isInteger(options.spacing) ? options.spacing as number : 2;
  return writeTextAtomic(target, `${JSON.stringify(value, null, spacing)}\n`, options);
}

function writeTextAtomicAsync(target: unknown, text: unknown, options: AsyncAtomicWriteOptions = {}): Promise<AtomicPersistenceResult> {
  const file = path.resolve(String(target));
  return serializeAsyncWrite(file, async () => {
    const directory = path.dirname(file);
    const mode = options.mode ?? 0o600;
    const durable = options.durable !== false;
    const backup = options.backup === true ? path.resolve(String(options.backupPath || `${file}.bak`)) : '';
    try {
      await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
      if (backup && await pathExistsAsync(file)) {
        await writeFileAtomic(backup, await fs.promises.readFile(file), { fsync: durable, mode });
      }
      await writeFileAtomic(file, String(text), { encoding: 'utf8', fsync: durable, mode });
      if (durable) await syncDirectoryAsync(directory);
      return { path: file, backupPath: backup || null };
    } catch (error) {
      throw new DurableStateError(
        'DURABLE_STATE_WRITE_FAILED',
        `Could not persist state file ${path.basename(file)}.`,
        { path: file, fsCode: errorCode(error) },
        { cause: error }
      );
    }
  });
}

function serializeAsyncWrite<T>(file: string, action: () => Promise<T>): Promise<T> {
  const previous = asyncWriteQueues.get(file) || Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  asyncWriteQueues.set(file, current);
  return current.finally(() => {
    if (asyncWriteQueues.get(file) === current) asyncWriteQueues.delete(file);
  });
}

function writeJsonAtomicAsync(target: unknown, value: unknown, options: AsyncJsonWriteOptions = {}): Promise<AtomicPersistenceResult> {
  const spacing = Number.isInteger(options.spacing) ? options.spacing as number : 2;
  return writeTextAtomicAsync(target, `${JSON.stringify(value, null, spacing)}\n`, options);
}

function readJsonFile<T = unknown>(target: unknown, options: JsonReadOptions<T> = {}): T | null {
  const file = path.resolve(String(target));
  const primary = parseJsonFile(file, options.validate);
  if (primary.ok) return primary.value as T;
  if (primary.missing) return fallbackValue(options);

  const backup = options.backup === true ? path.resolve(String(options.backupPath || `${file}.bak`)) : '';
  let backupReason = '';
  if (backup) {
    const recovered = parseJsonFile(backup, options.validate);
    backupReason = recovered.ok ? '' : recovered.reason;
    if (recovered.ok) {
      if (options.restoreBackup !== false) {
        writeJsonAtomic(file, recovered.value, { mode: options.mode ?? 0o600 });
      }
      options.onRecovery?.({ path: file, backupPath: backup, reason: primary.reason });
      return recovered.value as T;
    }
  }

  if (Object.hasOwn(options, 'fallback')) return cloneFallback(options.fallback as T);
  throw readFailure(file, primary, backup, backupReason);
}

async function readJsonFileAsync<T = unknown>(target: unknown, options: JsonReadOptions<T> = {}): Promise<T | null> {
  const file = path.resolve(String(target));
  const primary = await parseJsonFileAsync(file, options.validate);
  if (primary.ok) return primary.value as T;
  if (primary.missing) return fallbackValue(options);

  const backup = options.backup === true ? path.resolve(String(options.backupPath || `${file}.bak`)) : '';
  let backupReason = '';
  if (backup) {
    const recovered = await parseJsonFileAsync(backup, options.validate);
    backupReason = recovered.ok ? '' : recovered.reason;
    if (recovered.ok) {
      if (options.restoreBackup !== false) {
        await writeJsonAtomicAsync(file, recovered.value, { mode: options.mode ?? 0o600 });
      }
      options.onRecovery?.({ path: file, backupPath: backup, reason: primary.reason });
      return recovered.value as T;
    }
  }

  if (Object.hasOwn(options, 'fallback')) return cloneFallback(options.fallback as T);
  throw readFailure(file, primary, backup, backupReason);
}

function readFailure(file: string, primary: ParseFailure, backup: string, backupReason: string): DurableStateError {
  return new DurableStateError(
    'DURABLE_STATE_READ_FAILED',
    `State file ${path.basename(file)} is unreadable or invalid.`,
    {
      path: file,
      reason: primary.reason,
      backupAttempted: Boolean(backup),
      ...(backup ? { backupPath: backup, backupReason } : {})
    },
    primary.error === undefined ? {} : { cause: primary.error }
  );
}

function parseJsonFile(file: string, validate?: (value: unknown) => boolean): ParseResult {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return readParseFailure(error);
  }
  return parseJsonText(text, validate);
}

async function parseJsonFileAsync(file: string, validate?: (value: unknown) => boolean): Promise<ParseResult> {
  let text: string;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    return readParseFailure(error);
  }
  return parseJsonText(text, validate);
}

function readParseFailure(error: unknown): ParseFailure {
  if (['ENOENT', 'ENOTDIR'].includes(errorCode(error))) {
    return { ok: false, missing: true, reason: 'missing', error };
  }
  return { ok: false, missing: false, reason: 'read_failed', error };
}

function parseJsonText(text: string, validate?: (value: unknown) => boolean): ParseResult {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof validate === 'function' && validate(value) !== true) {
      return { ok: false, missing: false, reason: 'validation_failed' };
    }
    return { ok: true, missing: false, value };
  } catch (error) {
    return { ok: false, missing: false, reason: 'malformed_json', error };
  }
}

function fallbackValue<T>(options: JsonReadOptions<T>): T | null {
  if (Object.hasOwn(options, 'fallback')) return cloneFallback(options.fallback as T);
  return null;
}

function cloneFallback<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function promoteFile(source: string, destination: string): void {
  try {
    fs.renameSync(source, destination);
    return;
  } catch (error) {
    if (!fs.existsSync(destination) || !['EEXIST', 'EPERM', 'EACCES'].includes(errorCode(error))) throw error;
  }

  const displaced = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.old`;
  fs.renameSync(destination, displaced);
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    try { fs.renameSync(displaced, destination); } catch {}
    throw error;
  }
  fs.rmSync(displaced, { force: true });
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EACCES', 'ENOTSUP', 'EISDIR'].includes(errorCode(error))) throw error;
  } finally {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

async function syncDirectoryAsync(directory: string): Promise<void> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EACCES', 'ENOTSUP', 'EISDIR'].includes(errorCode(error))) throw error;
  } finally {
    if (handle != null) {
      try { await handle.close(); } catch {}
    }
  }
}

async function pathExistsAsync(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code || '') : '';
}

export {
  DurableStateError,
  promoteFile,
  readJsonFile,
  readJsonFileAsync,
  writeJsonAtomic,
  writeJsonAtomicAsync,
  writeTextAtomic
};
