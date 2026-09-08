import * as crypto from 'node:crypto';
import { taskError } from '../toolActivity.js';
import {
  assertAutomationAttribution,
  createAutomationAttribution,
  taskIdFor,
  type AutomationAttribution,
  type AutomationContext,
  type AutomationWorkspace
} from './automationAttribution.ts';
import {
  launchWebBrowserSession,
  type BrowserActionResult,
  type BrowserInteractionArgs,
  type WebBrowserSession
} from './webBrowserAdapter.ts';
import {
  assertUiSessionId,
  formatHost,
  normalizeAllowedPorts,
  normalizeLoopbackHost,
  normalizePort,
  normalizeProtocol,
  normalizeViewport,
  resolveUiRoute,
  timeoutFor
} from './webPolicy.ts';

const MAX_ACTIVE_SESSIONS = 8;

type UiArgs = Readonly<Record<string, unknown> & BrowserInteractionArgs & {
  action?: unknown;
  port?: unknown;
  protocol?: unknown;
  host?: unknown;
  allowedPorts?: unknown;
  route?: unknown;
  width?: unknown;
  height?: unknown;
  headless?: unknown;
  timeoutMs?: unknown;
  sessionId?: unknown;
  work_id?: unknown;
  fullPage?: unknown;
  maxEntries?: unknown;
  clear?: unknown;
}>;

type UiContext = AutomationContext & Readonly<Record<string, unknown>> & Readonly<{ signal?: AbortSignal }>;

type UiSessionRecord = Readonly<{
  sessionId: string;
  attribution: AutomationAttribution;
  origin: string;
  allowedPorts: ReadonlySet<number>;
  browser: WebBrowserSession;
  createdAt: string;
}>;

type SessionCallback<T> = (record: UiSessionRecord) => Promise<T> | T;

const sessions = new Map<string, UiSessionRecord>();
const pendingStarts = new Set<Readonly<{ taskId: string }>>();
const pendingSessionCloses = new Set<Promise<void>>();

async function startUiSession(
  workspace: AutomationWorkspace,
  args: UiArgs = {},
  context: UiContext = {}
): Promise<Record<string, unknown>> {
  throwIfUiAborted(context.signal);
  const taskId = taskIdFor(args, context);
  const existing = taskId ? [...sessions.values()].find(record => record.attribution.taskId === taskId) : null;
  const pendingForTask = taskId ? [...pendingStarts].some(pending => pending.taskId === taskId) : false;
  if (existing || pendingForTask) {
    const detail = existing ? `: ${existing.sessionId}` : '';
    throw taskError('UI_SESSION_ALREADY_ACTIVE', `Work session already has an active or starting UI test session${detail}. Stop it before starting another.`);
  }
  if (sessions.size + pendingStarts.size >= MAX_ACTIVE_SESSIONS) {
    throw taskError('UI_SESSION_LIMIT', `Rel.AI supports at most ${MAX_ACTIVE_SESSIONS} concurrent UI test sessions.`);
  }

  const port = normalizePort(args.port, 'port');
  const protocol = normalizeProtocol(args.protocol);
  const host = normalizeLoopbackHost(args.host || '127.0.0.1');
  const allowedPorts = normalizeAllowedPorts(port, args.allowedPorts);
  const origin = `${protocol}://${formatHost(host)}:${port}`;
  const initialUrl = resolveUiRoute(origin, args.route || '/');
  const viewport = normalizeViewport(args.width, args.height);
  const sessionId = `ui_${crypto.randomBytes(24).toString('base64url')}`;
  const createdAt = new Date().toISOString();
  const pendingStart = Object.freeze({ taskId });
  pendingStarts.add(pendingStart);
  let browser: WebBrowserSession | null = null;
  let record: UiSessionRecord | null = null;
  try {
    browser = await withUiAbortResource(launchWebBrowserSession({
      protocol,
      viewport,
      headless: args.headless !== false,
      allowedPorts
    }), context.signal, launchedBrowser => launchedBrowser.close());
    record = Object.freeze({
      sessionId,
      attribution: createAutomationAttribution(workspace, args, context),
      origin,
      allowedPorts,
      browser,
      createdAt
    });
    sessions.set(sessionId, record);
    browser.onDisconnected(() => sessions.delete(sessionId));

    const initialNavigation = await withUiAbort(browser.navigate(initialUrl, timeoutFor(args.timeoutMs)), context.signal);
    return {
      ok: true,
      workspace: workspace.alias,
      action: 'start',
      sessionId,
      url: initialNavigation.url,
      origin,
      statusCode: initialNavigation.statusCode ?? null,
      title: initialNavigation.title ?? '',
      viewport,
      browserEngine: 'chromium',
      browserProduct: browser.browserProduct,
      allowedPorts: [...allowedPorts].sort((left, right) => left - right),
      createdAt
    };
  } catch (error) {
    if (record) sessions.delete(sessionId);
    if (browser) await browser.close().catch(() => {});
    throw error;
  } finally {
    pendingStarts.delete(pendingStart);
  }
}

function withUiSession<T>(
  workspace: AutomationWorkspace,
  args: UiArgs,
  context: UiContext,
  callback: SessionCallback<T>
): Promise<T> | T {
  throwIfUiAborted(context.signal);
  return callback(requireUiSession(workspace, args, context));
}

function requireUiSession(
  workspace: AutomationWorkspace,
  args: UiArgs = {},
  context: UiContext = {}
): UiSessionRecord {
  const sessionId = assertUiSessionId(args.sessionId);
  const record = sessions.get(sessionId);
  if (!record) throw taskError('UI_SESSION_NOT_FOUND', `Unknown or closed UI test session: ${sessionId}.`);
  assertAutomationAttribution(record.attribution, workspace, args, context);
  return record;
}

async function stopUiSession(
  workspace: AutomationWorkspace,
  args: UiArgs = {},
  context: UiContext = {}
): Promise<Record<string, unknown>> {
  const record = requireUiSession(workspace, args, context);
  sessions.delete(record.sessionId);
  try {
    await record.browser.close();
    return {
      ok: true,
      workspace: workspace.alias,
      action: 'stop',
      sessionId: record.sessionId,
      status: 'stopped'
    };
  } catch (error) {
    return {
      ok: false,
      workspace: workspace.alias,
      action: 'stop',
      sessionId: record.sessionId,
      status: 'stopped',
      error: errorMessage(error)
    };
  }
}

async function stopUiSessionsForTask(taskId: string): Promise<{ stopped: number }> {
  const id = String(taskId || '').trim();
  if (!id) return { stopped: 0 };
  const records = [...sessions.values()].filter(record => record.attribution.taskId === id);
  for (const record of records) sessions.delete(record.sessionId);
  await trackUiRecordClose(records);
  return { stopped: records.length };
}

async function stopAllUiSessions(): Promise<{ stopped: number }> {
  const records = [...sessions.values()];
  sessions.clear();
  const closing = trackUiRecordClose(records);
  await Promise.allSettled([closing, ...pendingSessionCloses]);
  return { stopped: records.length };
}

function pageResult(record: UiSessionRecord, action: string, result: BrowserActionResult): Record<string, unknown> {
  return {
    ok: true,
    workspace: record.attribution.workspaceId,
    action,
    sessionId: record.sessionId,
    ...result
  };
}

async function trackUiRecordClose(records: readonly UiSessionRecord[]): Promise<void> {
  if (!records.length) return;
  const closing = closeUiRecords(records);
  pendingSessionCloses.add(closing);
  try {
    await closing;
  } finally {
    pendingSessionCloses.delete(closing);
  }
}

async function closeUiRecords(records: readonly UiSessionRecord[]): Promise<void> {
  await Promise.allSettled(records.map(record => record.browser.close()));
}

function throwIfUiAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw taskError('UI_OPERATION_CANCELLED', errorMessage(signal.reason || 'UI operation cancelled.'));
}

function withUiAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfUiAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(taskError('UI_OPERATION_CANCELLED', errorMessage(signal.reason || 'UI operation cancelled.')));
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

function withUiAbortResource<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  cleanup: (value: T) => Promise<unknown> | unknown
): Promise<T> {
  if (!signal) return promise;
  throwIfUiAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(taskError('UI_OPERATION_CANCELLED', errorMessage(signal.reason || 'UI operation cancelled.')));
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

export {
  pageResult,
  startUiSession,
  stopAllUiSessions,
  stopUiSession,
  stopUiSessionsForTask,
  withUiSession
};
export type { UiArgs, UiContext };
