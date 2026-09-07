import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { taskError } from '../toolActivity.js';
import { resolveSafePath } from '../safety.js';
import { resolveWorkspaceSourcePath } from '../workspaceSources.js';
import type { BrowserDownloadHandle, BrowserPageDriver } from './playwrightBrowserDriver.ts';
import type { StructuredInteractionArgs } from './playwrightPrimitives.ts';

type BrowserLocalIoWorkspace = Readonly<{
  alias: string;
  path: string;
  sourcePaths?: readonly string[];
}>;

type BrowserLocalIoArgs = Readonly<Record<string, unknown> & StructuredInteractionArgs & {
  path?: unknown;
}>;

type BrowserLocalIoOptions = Readonly<{ signal?: AbortSignal }>;

async function uploadAuthorizedBrowserFile(
  workspace: BrowserLocalIoWorkspace,
  page: BrowserPageDriver,
  args: BrowserLocalIoArgs,
  timeoutMs: number,
  options: BrowserLocalIoOptions = {}
): Promise<Record<string, unknown>> {
  throwIfCancelled(options.signal);
  const safe = resolveWorkspaceSourcePath(workspace, args.path, {
    operation: 'read',
    label: 'Browser upload file'
  });
  const before = await fs.promises.stat(safe.absolutePath);
  if (!before.isFile()) throw new Error(`Browser upload target is not a file: ${safe.relativePath}`);
  const result = await withAbort(page.upload(args, safe.absolutePath, timeoutMs), options.signal);
  return {
    ...result,
    path: safe.relativePath,
    bytes: before.size
  };
}

async function downloadBrowserFile(
  workspace: BrowserLocalIoWorkspace,
  page: BrowserPageDriver,
  args: BrowserLocalIoArgs,
  timeoutMs: number,
  options: BrowserLocalIoOptions = {}
): Promise<Record<string, unknown>> {
  throwIfCancelled(options.signal);
  const safe = resolveSafePath(workspace.path, args.path, {
    operation: 'write',
    label: 'Browser download destination'
  });
  if (fs.existsSync(safe.absolutePath)) throw new Error(`Browser download destination already exists: ${safe.relativePath}`);
  fs.mkdirSync(path.dirname(safe.absolutePath), { recursive: true, mode: 0o700 });
  const verified = resolveSafePath(workspace.path, safe.relativePath, {
    operation: 'write',
    label: 'Browser download destination'
  });
  if (fs.existsSync(verified.absolutePath)) throw new Error(`Browser download destination already exists: ${verified.relativePath}`);

  const download = await withAbortResource(
    page.beginDownload(args, timeoutMs),
    options.signal,
    handle => cleanupDownload(handle, true)
  );
  const tempPath = path.join(
    path.dirname(verified.absolutePath),
    `.${path.basename(verified.absolutePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.relai-download`
  );
  let linked = false;
  let bytes = 0;
  const hash = crypto.createHash('sha256');
  const hashing = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      hash.update(buffer);
      callback(null, buffer);
    }
  });

  try {
    const readable = await withAbortResource(download.createReadStream(), options.signal, stream => stream.destroy());
    const output = fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
    try {
      await pipeline(readable, hashing, output, options.signal ? { signal: options.signal } : {});
    } catch (error) {
      if (options.signal?.aborted) throw cancelledError(options.signal);
      throw error;
    }
    if (fs.existsSync(verified.absolutePath)) throw new Error(`Browser download destination already exists: ${verified.relativePath}`);
    await fs.promises.link(tempPath, verified.absolutePath);
    linked = true;
    return {
      ok: true,
      path: verified.relativePath,
      bytes,
      sha256: hash.digest('hex'),
      suggestedFilename: normalizeSuggestedFilename(download.suggestedFilename),
      changed: true
    };
  } catch (error) {
    if (linked) await fs.promises.rm(verified.absolutePath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    await cleanupDownload(download, options.signal?.aborted === true);
  }
}

function normalizeSuggestedFilename(value: unknown): string {
  const leaf = path.basename(String(value || '').replaceAll('\\', '/')).trim();
  return !leaf || leaf === '.' || leaf === '..' ? 'download' : leaf.slice(0, 255);
}

async function cleanupDownload(download: BrowserDownloadHandle, cancel: boolean): Promise<void> {
  if (cancel) await download.cancel().catch(() => {});
  await download.delete().catch(() => {});
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError(signal);
}

function cancelledError(signal: AbortSignal): Error {
  return taskError('BROWSER_OPERATION_CANCELLED', errorMessage(signal.reason || 'Browser operation cancelled.'));
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfCancelled(signal);
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(cancelledError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        if (!aborted) resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        if (!aborted) reject(error);
      }
    );
  });
}

function withAbortResource<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  cleanup: (value: T) => Promise<unknown> | unknown
): Promise<T> {
  if (!signal) return promise;
  throwIfCancelled(signal);
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(cancelledError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        if (!aborted) {
          resolve(value);
          return;
        }
        void Promise.resolve(cleanup(value)).catch(() => {});
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        if (!aborted) reject(error);
      }
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

export { downloadBrowserFile, normalizeSuggestedFilename, uploadAuthorizedBrowserFile };
export type { BrowserLocalIoArgs, BrowserLocalIoOptions, BrowserLocalIoWorkspace };
