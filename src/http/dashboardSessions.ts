import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LRUCache } from 'lru-cache';

const BOOTSTRAP_TTL_MS = 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = 'relai_dashboard_session';

interface SessionRecord {
  tokenHash: string;
}

const bootstraps = new LRUCache<string, SessionRecord>({ max: 512, ttl: BOOTSTRAP_TTL_MS });
const sessions = new LRUCache<string, SessionRecord>({ max: 2048, ttl: SESSION_TTL_MS, updateAgeOnGet: true });

function createDashboardBootstrap(staticToken: string): string {
  const code = crypto.randomBytes(24).toString('base64url');
  bootstraps.set(code, { tokenHash: hashToken(staticToken) });
  return code;
}

function consumeDashboardBootstrap(code: string | null | undefined, staticToken: string): string {
  const key = String(code || '');
  const record = bootstraps.get(key);
  bootstraps.delete(key);
  if (!record) return '';
  if (!safeEqual(record.tokenHash, hashToken(staticToken))) return '';
  return createSession(record.tokenHash);
}

function createDashboardSession(
  providedToken: string | null | undefined,
  staticToken: string
): string {
  const provided = String(providedToken || '');
  const expected = String(staticToken || '');
  if (!provided || !expected) return '';
  const providedHash = hashToken(provided);
  const expectedHash = hashToken(expected);
  if (!safeEqual(providedHash, expectedHash)) return '';
  return createSession(expectedHash);
}

function createSession(tokenHash: string): string {
  const sessionId = crypto.randomBytes(32).toString('base64url');
  sessions.set(sessionId, { tokenHash });
  return sessionId;
}

function validateDashboardSession(
  req: IncomingMessage,
  staticToken: string,
  res: ServerResponse<IncomingMessage>
): boolean {
  const sessionId = cookieValue(req.headers.cookie, COOKIE_NAME);
  if (!sessionId) return false;
  const record = sessions.get(sessionId);
  if (!record || !safeEqual(record.tokenHash, hashToken(staticToken))) return false;
  setDashboardSessionCookie(res, sessionId);
  return true;
}

function setDashboardSessionCookie(res: ServerResponse<IncomingMessage>, sessionId: string): void {
  if (!sessionId || res.headersSent) return;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearDashboardSessions(): void {
  bootstraps.clear();
  sessions.clear();
}

function cookieValue(header: string | undefined, name: string): string {
  const target = `${name}=`;
  for (const part of String(header || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(target)) return value.slice(target.length);
  }
  return '';
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export {
  clearDashboardSessions,
  consumeDashboardBootstrap,
  createDashboardBootstrap,
  createDashboardSession,
  setDashboardSessionCookie,
  validateDashboardSession
};
