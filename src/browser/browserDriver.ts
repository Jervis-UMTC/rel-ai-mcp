import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  launchLocalBrowserDriver,
  type BrowserDownloadHandle,
  type BrowserPageDriver,
  type BrowserPageResult,
  type LaunchBrowserDriverOptions,
  type LocalBrowserDriver
} from './playwrightBrowserDriver.ts';
import type { StructuredInteractionArgs } from './playwrightPrimitives.ts';

type NativeBrowserBridge = (payload: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
type NativeBrowserEvent = Readonly<Record<string, unknown> & {
  resource?: unknown;
  type?: unknown;
  nativeSessionId?: unknown;
  nativePageId?: unknown;
}>;

type NativePageListeners = {
  nativeSessionId: string;
  onClosed: (() => void) | null;
  onCrashed: (() => void) | null;
};

const DOWNLOAD_TEMP_ROOT = path.resolve(os.tmpdir(), 'relai-browser-downloads');
let nativeBrowserBridge: NativeBrowserBridge | null = null;
const sessionDisconnectListeners = new Map<string, () => void>();
const pageListeners = new Map<string, NativePageListeners>();

function configureBrowserNativeBridge(bridge: NativeBrowserBridge | null): void {
  if (bridge !== null && typeof bridge !== 'function') throw new TypeError('Browser native bridge must be a function or null.');
  nativeBrowserBridge = bridge;
}

function dispatchBrowserNativeEvent(event: NativeBrowserEvent = {}): void {
  if (String(event.resource || '') !== 'browser') return;
  const type = String(event.type || '');
  const nativeSessionId = String(event.nativeSessionId || '');
  const nativePageId = String(event.nativePageId || '');

  if (type === 'session_disconnected' && nativeSessionId) {
    const listener = sessionDisconnectListeners.get(nativeSessionId);
    sessionDisconnectListeners.delete(nativeSessionId);
    for (const [pageId, entry] of pageListeners) {
      if (entry.nativeSessionId === nativeSessionId) pageListeners.delete(pageId);
    }
    listener?.();
    return;
  }

  if (!nativePageId) return;
  const entry = pageListeners.get(nativePageId);
  if (!entry) return;
  if (type === 'page_crashed') {
    pageListeners.delete(nativePageId);
    entry.onCrashed?.();
  } else if (type === 'page_closed') {
    pageListeners.delete(nativePageId);
    entry.onClosed?.();
  }
}

async function launchBrowserDriver(options: LaunchBrowserDriverOptions): Promise<LocalBrowserDriver> {
  const bridge = nativeBrowserBridge;
  if (!bridge) return launchLocalBrowserDriver(options);

  const started = objectValue(await bridge({
    action: 'start',
    viewport: options.viewport,
    ignoreHTTPSErrors: options.ignoreHTTPSErrors === true,
    ...(options.profileDirectory ? { profileDirectory: options.profileDirectory } : {})
  }));
  const nativeSessionId = requiredId(started.nativeSessionId, 'Embedded browser session');
  let onDisconnected: (() => void) | null = null;
  sessionDisconnectListeners.set(nativeSessionId, () => onDisconnected?.());

  return Object.freeze({
    browserProduct: String(started.browserProduct || 'Rel.AI Embedded Chromium'),
    createPage: () => createNativePage(bridge, nativeSessionId),
    close: async () => {
      sessionDisconnectListeners.delete(nativeSessionId);
      for (const [pageId, entry] of pageListeners) {
        if (entry.nativeSessionId === nativeSessionId) pageListeners.delete(pageId);
      }
      await bridge({ action: 'close_session', nativeSessionId });
    },
    onDisconnected: (listener: () => void) => { onDisconnected = listener; }
  });
}

async function createNativePage(bridge: NativeBrowserBridge, nativeSessionId: string): Promise<BrowserPageDriver> {
  const opened = objectValue(await bridge({ action: 'open_page', nativeSessionId }));
  const nativePageId = requiredId(opened.nativePageId, 'Embedded browser page');
  const listeners: NativePageListeners = { nativeSessionId, onClosed: null, onCrashed: null };
  pageListeners.set(nativePageId, listeners);

  const request = async (action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    objectValue(await bridge({ action, nativeSessionId, nativePageId, ...extra }));
  const requestPage = async (action: string, extra: Record<string, unknown> = {}): Promise<BrowserPageResult> => {
    const result = await request(action, extra);
    return { ...result, url: String(result.url || '') };
  };

  return Object.freeze({
    describe: () => requestPage('describe'),
    navigate: (url: string, timeoutMs: number) => requestPage('navigate', { url, timeoutMs }),
    snapshot: (timeoutMs: number) => requestPage('snapshot', { timeoutMs }),
    interact: (args: StructuredInteractionArgs, timeoutMs: number) => requestPage('interact', { ...args, timeoutMs }),
    screenshot: (fullPage: boolean) => requestPage('screenshot', { fullPage }),
    upload: (args: StructuredInteractionArgs, filePath: string, timeoutMs: number) =>
      requestPage('upload', { target: args.target, filePath, timeoutMs }),
    beginDownload: async (args: StructuredInteractionArgs, timeoutMs: number): Promise<BrowserDownloadHandle> => {
      const result = await request('begin_download', { ...args, timeoutMs });
      const tempPath = requireDownloadTempPath(result.tempPath);
      const suggestedFilename = String(result.suggestedFilename || 'download');
      return Object.freeze({
        suggestedFilename,
        createReadStream: async () => fs.createReadStream(tempPath),
        cancel: async () => {},
        delete: async () => { await fs.promises.rm(tempPath, { force: true }).catch(() => {}); }
      });
    },
    close: async () => {
      pageListeners.delete(nativePageId);
      await bridge({ action: 'close_page', nativeSessionId, nativePageId });
    },
    onClosed: (listener: () => void) => { listeners.onClosed = listener; },
    onCrashed: (listener: () => void) => { listeners.onCrashed = listener; }
  });
}

function requireDownloadTempPath(value: unknown): string {
  const candidate = path.resolve(String(value || ''));
  const relative = path.relative(DOWNLOAD_TEMP_ROOT, candidate);
  if (!candidate || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Embedded browser download did not return an authorized temporary file.');
  }
  return candidate;
}

function requiredId(value: unknown, label: string): string {
  const id = String(value || '').trim();
  if (!id) throw new Error(`${label} identifier is unavailable.`);
  return id;
}

function objectValue(value: Record<string, unknown> | void): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export {
  DOWNLOAD_TEMP_ROOT,
  configureBrowserNativeBridge,
  dispatchBrowserNativeEvent,
  launchBrowserDriver
};
export type { BrowserDownloadHandle, BrowserPageDriver, LaunchBrowserDriverOptions, LocalBrowserDriver, NativeBrowserBridge };
