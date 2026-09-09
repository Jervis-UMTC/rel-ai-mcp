import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  completeDashboardOnboarding,
  createDashboardEventSubscription,
  dashboardConnection,
  dashboardHealth,
  dashboardLogs,
  dashboardOnboardingStatus,
  dashboardReleaseNotes,
  dashboardRequiresHttpToken,
  dashboardSnapshot,
  dashboardTaskSession,
  dashboardTools,
  dashboardWorkspacePreflight,
  updateDashboardWorkspace
} from '../core/dashboard-runtime.ts';
import { ERROR_CODES, errorPayload } from '../contracts/errors.ts';
import { resolvePackagePath } from '../packageMetadata.js';
import { handleOpenFolder, handlePickFolder, handleWorkspaceChecks } from './dashboardActions.ts';
import { readCachedStaticAsset } from './dashboardAssets.ts';
import { renderDashboardShellBootstrap } from './dashboardShellChrome.ts';
import { contentTypeForStaticAsset, readJsonBody, sendHtml, sendJson, sendSse } from './io.ts';
import type { HttpRouteContext, HttpServerOptions } from './types.ts';

async function handleFavicon(ctx: HttpRouteContext): Promise<void> {
  try {
    const content = readCachedStaticAsset(resolvePackagePath('public', 'assets', 'favicon.ico'));
    ctx.res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'private, max-age=60' });
    ctx.res.end(content);
  } catch {
    ctx.res.writeHead(404);
    ctx.res.end('Not found');
  }
}

function handleHealth(ctx: HttpRouteContext): void {
  sendJson(ctx.res, 200, dashboardHealth(ctx.options));
}

function handleStaticAsset(ctx: HttpRouteContext): void {
  const safePath = ctx.parsed.pathname.replaceAll('\\', '/');
  if (safePath.includes('..')) {
    ctx.res.writeHead(400);
    ctx.res.end('Bad path');
    return;
  }
  let filePath: string;
  if (safePath.startsWith('/ui/')) {
    filePath = resolvePackagePath('src', 'ui', safePath.slice(4));
  } else if (safePath.startsWith('/public/ui/')) {
    filePath = resolvePackagePath('src', 'ui', safePath.slice(11));
  } else if (safePath.startsWith('/vendor/monaco/')) {
    filePath = resolvePackagePath('node_modules', 'monaco-editor', 'min', 'vs', safePath.slice('/vendor/monaco/'.length));
  } else {
    filePath = resolvePackagePath('public', safePath.slice(8));
  }
  try {
    const content = readCachedStaticAsset(filePath);
    const contentType = contentTypeForStaticAsset(safePath);
    const charset = contentType.startsWith('text/') || contentType === 'application/javascript' ? '; charset=utf-8' : '';
    ctx.res.writeHead(200, { 'Content-Type': contentType + charset, 'Cache-Control': 'private, max-age=60' });
    ctx.res.end(content);
  } catch {
    ctx.res.writeHead(404);
    ctx.res.end('Not found');
  }
}

function handleDashboard(ctx: HttpRouteContext): void {
  const nonce = crypto.randomBytes(18).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; ');
  sendHtml(ctx.res, 200, renderDashboardHtml(nonce), {
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  });
}

function handleApiTools(ctx: HttpRouteContext): void {
  try {
    sendJson(ctx.res, 200, dashboardTools());
  } catch (error) {
    sendJson(ctx.res, 500, errorPayload(ERROR_CODES.UNKNOWN, errorMessage(error)));
  }
}

function handleOnboardingStatus(ctx: HttpRouteContext): void {
  sendJson(ctx.res, 200, dashboardOnboardingStatus());
}

function handleConnection(ctx: HttpRouteContext): void {
  sendJson(ctx.res, 200, dashboardConnection(ctx.options));
}

function handleDashboardV10(ctx: HttpRouteContext): void {
  sendJson(ctx.res, 200, dashboardSnapshot(ctx.options, {
    limit: Number(ctx.parsed.searchParams.get('limit') || 100),
    requireHttpToken: dashboardRequiresHttpToken(ctx.parsed.searchParams.get('requireHttpToken'))
  }));
}

async function handleWorkspacePreflight(ctx: HttpRouteContext): Promise<void> {
  sendJson(ctx.res, 200, await dashboardWorkspacePreflight({
    path: ctx.parsed.searchParams.get('path') || '',
    workspace: ctx.parsed.searchParams.get('workspace') || '',
    requireClean: ctx.parsed.searchParams.get('requireClean') !== '0'
  }));
}

function handleEvents(ctx: HttpRouteContext): void {
  openDashboardEvents(ctx.res, ctx.req, ctx.options);
}

async function handleOnboardingComplete(ctx: HttpRouteContext): Promise<void> {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  sendJson(ctx.res, 200, completeDashboardOnboarding(payload));
}

async function handleApiWorkspaces(ctx: HttpRouteContext): Promise<void> {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  sendJson(ctx.res, 200, await updateDashboardWorkspace(payload));
}

function openDashboardEvents(
  res: ServerResponse<IncomingMessage>,
  req: IncomingMessage,
  options: HttpServerOptions
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const subscription = createDashboardEventSubscription(options, {
    onReady: payload => sendSse(res, 'ready', payload),
    onEvent: (eventName, payload) => sendSse(res, eventName, payload, { id: `${payload.streamId}:${payload.sequence}` }),
    onError: error => sendDashboardStreamError(res, error)
  });
  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);
  heartbeat.unref?.();
  req.on('close', () => {
    subscription.close();
    clearInterval(heartbeat);
  });
}

function sendDashboardStreamError(res: ServerResponse<IncomingMessage>, error: unknown): void {
  if (res.destroyed) return;
  sendSse(res, 'dashboard.error', errorPayload(ERROR_CODES.UNKNOWN, errorMessage(error)));
}

function renderDashboardHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overview · Rel.AI MCP</title>
<link rel="icon" href="/public/assets/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/public/assets/favicon.png">
<link rel="apple-touch-icon" href="/public/assets/relai-logo-192.png">
<script nonce="${nonce}">${renderDashboardShellBootstrap()}</script>
<link rel="stylesheet" href="/public/dashboard.css">
</head>
<body>
<div id="dashboardRoot"></div>
<script type="module" src="/public/dashboard-app.js"></script>
</body>
</html>`;
}

const handleTaskSession = (ctx: HttpRouteContext): void => {
  const taskId = String(ctx.parsed.searchParams.get('task') || '').trim();
  if (!taskId) {
    sendJson(ctx.res, 400, { ok: false, error: 'task is required.' });
    return;
  }
  const result = dashboardTaskSession(taskId);
  if (!result) {
    sendJson(ctx.res, 404, { ok: false, error: 'Work session not found.' });
    return;
  }
  sendJson(ctx.res, 200, result);
};

const handleApiLogs = (ctx: HttpRouteContext): void => {
  const limit = Number(ctx.parsed.searchParams.get('limit') || 100);
  sendJson(ctx.res, 200, dashboardLogs(ctx.options, limit));
};

const handleReleaseNotes = (ctx: HttpRouteContext): void => sendJson(ctx.res, 200, dashboardReleaseNotes());

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  handleFavicon,
  handleHealth,
  handleStaticAsset,
  handleDashboard,
  handleApiTools,
  handleOnboardingStatus,
  handleConnection,
  handleDashboardV10,
  handleTaskSession,
  handleApiLogs,
  handleReleaseNotes,
  handleWorkspacePreflight,
  handleEvents,
  handleOnboardingComplete,
  handleApiWorkspaces,
  handlePickFolder,
  handleOpenFolder,
  handleWorkspaceChecks
};
