import type { IncomingMessage } from 'node:http';

import { ERROR_CODES, type ErrorCode } from '../contracts/errors.ts';

function isLoopbackHost(host: unknown): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host || '').toLowerCase());
}

function errorCodeForRequest(req: IncomingMessage): ErrorCode {
  const requestPath = String(req.url || '').split('?')[0] || '';
  if (requestPath === '/api/workspaces' || requestPath.startsWith('/api/workspace/')) return ERROR_CODES.WORKSPACE_UNAVAILABLE;
  if (requestPath === '/api/diagnostics/reset') return ERROR_CODES.STATE_RESET_FAILED;
  if (requestPath === '/api/diagnostics') return ERROR_CODES.DIAGNOSTICS_UNAVAILABLE;
  return ERROR_CODES.UNKNOWN;
}

export { errorCodeForRequest, isLoopbackHost };
