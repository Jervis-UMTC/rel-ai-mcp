import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getStateDir } from '../stateLayout.js';

const BROWSER_PROFILE_MODES = Object.freeze(['ephemeral', 'persistent'] as const);
type BrowserProfileMode = typeof BROWSER_PROFILE_MODES[number];

function normalizeBrowserProfileMode(value: unknown): BrowserProfileMode {
  const mode = String(value || 'ephemeral').trim().toLowerCase();
  if (mode !== 'ephemeral' && mode !== 'persistent') {
    throw new Error('Browser profile must be ephemeral or persistent.');
  }
  return mode;
}

function persistentBrowserProfileRoot(config: Record<string, unknown> = {}): string {
  return path.join(path.resolve(getStateDir(config)), 'browser', 'profiles');
}

function browserProfileDirectory(config: Record<string, unknown>, principalFingerprint: string): string {
  const fingerprint = String(principalFingerprint || '').trim();
  if (!fingerprint) throw new Error('Persistent browser profile requires a principal fingerprint.');
  const principalKey = crypto.createHash('sha256').update(fingerprint, 'utf8').digest('hex');
  return path.join(persistentBrowserProfileRoot(config), principalKey, 'default');
}

function preparePersistentBrowserProfile(config: Record<string, unknown>, principalFingerprint: string): string {
  const directory = browserProfileDirectory(config, principalFingerprint);
  const root = persistentBrowserProfileRoot(config);
  const rootExisting = safeLstat(root);
  if (rootExisting?.isSymbolicLink()) throw new Error('Persistent browser profile root must not be a symbolic link.');
  if (rootExisting && !rootExisting.isDirectory()) throw new Error('Persistent browser profile root is not a directory.');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  const principalDirectory = path.dirname(directory);
  const principalExisting = safeLstat(principalDirectory);
  if (principalExisting?.isSymbolicLink()) throw new Error('Persistent browser profile principal path must not be a symbolic link.');
  if (principalExisting && !principalExisting.isDirectory()) throw new Error('Persistent browser profile principal path is not a directory.');
  fs.mkdirSync(principalDirectory, { recursive: true, mode: 0o700 });

  const existing = safeLstat(directory);
  if (existing?.isSymbolicLink()) throw new Error('Persistent browser profile path must not be a symbolic link.');
  if (existing && !existing.isDirectory()) throw new Error('Persistent browser profile path is not a directory.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
  return directory;
}

async function clearPersistentBrowserProfiles(config: Record<string, unknown> = {}): Promise<{ cleared: boolean }> {
  const root = persistentBrowserProfileRoot(config);
  const existing = safeLstat(root);
  if (!existing) return { cleared: false };
  if (existing.isSymbolicLink()) throw new Error('Refusing to clear a symbolic-link browser profile root.');
  if (!existing.isDirectory()) throw new Error('Browser profile root is not a directory.');
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  return { cleared: true };
}

function safeLstat(file: string): fs.Stats | null {
  try { return fs.lstatSync(file); } catch { return null; }
}

export {
  BROWSER_PROFILE_MODES,
  browserProfileDirectory,
  clearPersistentBrowserProfiles,
  normalizeBrowserProfileMode,
  persistentBrowserProfileRoot,
  preparePersistentBrowserProfile
};
export type { BrowserProfileMode };
