import type { IncomingMessage, ServerResponse } from 'node:http';

import * as dashboardSessions from './dashboardSessions.ts';
import type { ResolvedHttpServerOptions } from './types.ts';

function isDashboardAuthorized(
  req: IncomingMessage,
  parsed: URL,
  options: Pick<ResolvedHttpServerOptions, 'token'>,
  res: ServerResponse<IncomingMessage>
): boolean {
  if (dashboardSessions.validateDashboardSession(req, options.token, res)) return true;
  if (parsed.pathname !== '/dashboard') return false;
  const bootstrap = parsed.searchParams.get('bootstrap');
  const queryToken = parsed.searchParams.get('token');
  const sessionId = bootstrap
    ? dashboardSessions.consumeDashboardBootstrap(bootstrap, options.token)
    : dashboardSessions.createDashboardSession(queryToken, options.token);
  if (!sessionId) return false;
  dashboardSessions.setDashboardSessionCookie(res, sessionId);
  return true;
}

export { isDashboardAuthorized };
