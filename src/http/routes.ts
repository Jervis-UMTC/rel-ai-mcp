import type { IncomingMessage, ServerResponse } from 'node:http';

import { ERROR_CODES, errorPayload } from '../contracts/errors.ts';
import { isDashboardAuthorized } from './auth.ts';
import {
  handleApiLogs,
  handleApiTools,
  handleApiWorkspaces,
  handleConnection,
  handleDashboard,
  handleDashboardV10,
  handleEvents,
  handleFavicon,
  handleHealth,
  handleOnboardingComplete,
  handleOnboardingStatus,
  handleOpenFolder,
  handlePickFolder,
  handleReleaseNotes,
  handleStaticAsset,
  handleTaskSession,
  handleWorkspaceChecks,
  handleWorkspacePreflight
} from './dashboard.ts';
import { handleApiComputer, handleApiComputerAction } from './dashboardComputer.ts';
import { handleApiDiagnostics, handleApiDiagnosticsReset } from './dashboardDiagnostics.ts';
import { handleApiProcessStop } from './dashboardProcesses.ts';
import { getMcpAccess } from './mcp.ts';
import { handleMcpDelete, handleMcpGetDiagnostic, handleMcpStreamable } from './mcpTransport.ts';
import { setBaseHeaders, sendJson } from './io.ts';
import type { HttpRouteContext, ResolvedHttpServerOptions, RouteDefinition } from './types.ts';

const NOT_FOUND_PAYLOAD = {
  ok: false,
  error: 'Not found.',
  endpoints: {
    health: 'GET /health',
    dashboard: 'GET /dashboard',
    dashboardV10Api: 'GET /api/dashboard/v10',
    logsApi: 'GET /api/logs',
    diagnosticsApi: 'GET /api/diagnostics',
    diagnosticsResetApi: 'POST /api/diagnostics/reset',
    updateWorkspacesApi: 'POST /api/workspaces',
    workspacePreflightApi: 'GET /api/workspace/preflight?workspace=...',
    events: 'GET /events',
    streamableHttp: 'POST /mcp (MCP 2026-07-28; Authentication: private Bearer token)'
  }
} as const;

function authDashboard(ctx: HttpRouteContext): boolean {
  if (isDashboardAuthorized(ctx.req, ctx.parsed, ctx.options, ctx.res)) return true;
  sendJson(ctx.res, 401, errorPayload(
    ERROR_CODES.DASHBOARD_UNAVAILABLE,
    'Dashboard authorization expired. Reopen the dashboard from the Rel.AI desktop app.'
  ));
  return false;
}

function authNone(): boolean {
  return true;
}

const GET_ROUTES: Readonly<Record<string, RouteDefinition>> = Object.freeze({
  '/dashboard': { auth: authDashboard, handler: handleDashboard },
  '/favicon.ico': { auth: authNone, handler: handleFavicon },
  '/health': { auth: authNone, handler: handleHealth },
  '/api/tools': { auth: authDashboard, handler: handleApiTools },
  '/api/onboarding/status': { auth: authDashboard, handler: handleOnboardingStatus },
  '/api/connection': { auth: authDashboard, handler: handleConnection },
  '/api/dashboard/v10': { auth: authDashboard, handler: handleDashboardV10 },
  '/api/tasks/session': { auth: authDashboard, handler: handleTaskSession },
  '/api/logs': { auth: authDashboard, handler: handleApiLogs },
  '/api/diagnostics': { auth: authDashboard, handler: handleApiDiagnostics },
  '/api/computer': { auth: authDashboard, handler: handleApiComputer },
  '/api/release-notes': { auth: authDashboard, handler: handleReleaseNotes },
  '/api/workspace/preflight': { auth: authDashboard, handler: handleWorkspacePreflight },
  '/events': { auth: authDashboard, handler: handleEvents }
});

const POST_ROUTES: Readonly<Record<string, RouteDefinition>> = Object.freeze({
  '/api/onboarding/complete': { auth: authDashboard, handler: handleOnboardingComplete },
  '/api/workspaces': { auth: authDashboard, handler: handleApiWorkspaces },
  '/api/diagnostics/reset': { auth: authDashboard, handler: handleApiDiagnosticsReset },
  '/api/computer': { auth: authDashboard, handler: handleApiComputerAction },
  '/api/pick-folder': { auth: authDashboard, handler: handlePickFolder },
  '/api/open-folder': { auth: authDashboard, handler: handleOpenFolder },
  '/api/workspace/checks': { auth: authDashboard, handler: handleWorkspaceChecks },
  '/api/processes/stop': { auth: authDashboard, handler: handleApiProcessStop }
});

async function routeHttpRequest(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  options: ResolvedHttpServerOptions
): Promise<void> {
  setBaseHeaders(req, res, options);
  const parsed = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const mcpAccess = getMcpAccess(parsed.pathname);
  if (mcpAccess.kind !== 'none' && blockMcpForRuntimeAccess(res, options.getRuntimeAccess)) return;
  const ctx: HttpRouteContext = { req, res, options, parsed, mcpAccess, p: parsed.pathname };

  if (req.method === 'GET') {
    if (await dispatchExact(GET_ROUTES, ctx)) return;
    if (tryStaticAsset(ctx)) return;
    if (ctx.mcpAccess.kind === 'streamable-http') {
      await handleMcpGetDiagnostic(ctx);
      return;
    }
  } else if (req.method === 'POST') {
    if (await dispatchExact(POST_ROUTES, ctx)) return;
    if (ctx.mcpAccess.kind === 'streamable-http') {
      await handleMcpStreamable(ctx);
      return;
    }
  } else if (req.method === 'DELETE' && ctx.mcpAccess.kind === 'streamable-http') {
    await handleMcpDelete(ctx);
    return;
  }

  sendJson(res, 404, NOT_FOUND_PAYLOAD);
}

async function dispatchExact(
  routes: Readonly<Record<string, RouteDefinition>>,
  ctx: HttpRouteContext
): Promise<boolean> {
  const entry = routes[ctx.p];
  if (!entry) return false;
  if (!entry.auth(ctx)) return true;
  await entry.handler(ctx);
  return true;
}

function tryStaticAsset(ctx: HttpRouteContext): boolean {
  const p = ctx.p;
  if (!p.startsWith('/ui/') && !p.startsWith('/public/') && !p.startsWith('/vendor/monaco/')) return false;
  handleStaticAsset(ctx);
  return true;
}

function blockMcpForRuntimeAccess(
  res: ServerResponse<IncomingMessage>,
  getRuntimeAccess: ResolvedHttpServerOptions['getRuntimeAccess']
): boolean {
  if (typeof getRuntimeAccess !== 'function') return false;
  let access;
  try {
    access = getRuntimeAccess();
  } catch {
    return false;
  }
  if (access?.blocked !== true) return false;
  sendJson(res, 426, errorPayload(
    access.errorCode || ERROR_CODES.UPDATE_REQUIRED,
    access.message || 'Update Rel.AI MCP before continuing MCP work.'
  ));
  return true;
}

export { routeHttpRequest };
