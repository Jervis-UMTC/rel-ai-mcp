const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const MAX_SNAPSHOT_CHARS = 64 * 1024;
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set<string>(['localhost', '127.0.0.1', '::1']);
const UI_SESSION_ID = /^ui_[A-Za-z0-9_-]{20,160}$/;

function normalizeUiRoute(route: unknown): string {
  const value = String(route ?? '').trim();
  if (!value.startsWith('/')) throw new Error("UI route must be a local path beginning with '/'.");
  if (value.startsWith('//')) throw new Error('Protocol-relative UI routes are not accepted.');
  if (value.includes('\\')) throw new Error('Backslashes are not accepted in UI routes.');
  return value;
}

function resolveUiRoute(origin: string, route: unknown): string {
  const value = normalizeUiRoute(route);
  const url = new URL(value, `${origin}/`);
  if (url.origin !== origin) throw new Error('UI route escaped the configured local origin.');
  return url.href;
}

function isAllowedResourceUrl(value: unknown, allowedPorts: ReadonlySet<number>): boolean {
  try {
    const url = new URL(String(value));
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return true;
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return isAllowedLoopbackUrl(url, allowedPorts);
  } catch {
    return false;
  }
}

function isAllowedSocketUrl(value: unknown, allowedPorts: ReadonlySet<number>): boolean {
  try {
    const url = new URL(String(value));
    if (!['ws:', 'wss:'].includes(url.protocol)) return false;
    return isAllowedLoopbackUrl(url, allowedPorts);
  } catch {
    return false;
  }
}

function isAllowedPageUrl(value: unknown, allowedPorts: ReadonlySet<number>): boolean {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return isAllowedLoopbackUrl(url, allowedPorts);
  } catch {
    return false;
  }
}

function sanitizeUiUrl(value: unknown): string {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    if (url.search) url.search = '?[redacted]';
    return url.href;
  } catch {
    return '';
  }
}

function normalizeAllowedPorts(primaryPort: number, values: unknown): Set<number> {
  const ports = new Set([primaryPort]);
  if (values != null && !Array.isArray(values)) throw new Error('allowedPorts must be an array of local TCP ports.');
  for (const value of values || []) ports.add(normalizePort(value, 'allowedPorts entry'));
  if (ports.size > 10) throw new Error('allowedPorts supports at most 10 local ports per UI session.');
  return ports;
}

function normalizeViewport(width: unknown, height: unknown, requireBoth = false): { width: number; height: number } {
  if (requireBoth && (width == null || height == null)) throw new Error('viewport requires width and height.');
  return {
    width: clampInteger(width, 320, 3840, DEFAULT_VIEWPORT.width),
    height: clampInteger(height, 240, 2160, DEFAULT_VIEWPORT.height)
  };
}

function normalizeLoopbackHost(value: unknown): string {
  const host = normalizeHostForComparison(value);
  if (!LOOPBACK_HOSTS.has(host)) throw new Error('UI host must be localhost, 127.0.0.1, or ::1.');
  return host;
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function normalizeProtocol(value: unknown): 'http' | 'https' {
  const protocol = String(value || 'http').trim().toLowerCase().replace(/:$/, '');
  if (!['http', 'https'].includes(protocol)) throw new Error('UI protocol must be http or https.');
  return protocol as 'http' | 'https';
}

function normalizePort(value: unknown, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} must be an integer from 1 to 65535.`);
  return port;
}

function normalizeWaitState(value: unknown): 'visible' | 'hidden' | 'attached' | 'detached' {
  const state = String(value || 'visible').trim().toLowerCase();
  if (!['visible', 'hidden', 'attached', 'detached'].includes(state)) throw new Error('wait state must be visible, hidden, attached, or detached.');
  return state as 'visible' | 'hidden' | 'attached' | 'detached';
}

function timeoutFor(value: unknown): number {
  return clampInteger(value, 100, 30_000, DEFAULT_TIMEOUT_MS);
}

function boundText(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  const text = String(value || '');
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n[truncated]`, truncated: true };
}

function assertUiSessionId(value: unknown): string {
  const sessionId = String(value || '').trim();
  if (!UI_SESSION_ID.test(sessionId)) throw new Error('Invalid UI sessionId.');
  return sessionId;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function isAllowedLoopbackUrl(url: URL, allowedPorts: ReadonlySet<number>): boolean {
  const host = normalizeHostForComparison(url.hostname);
  if (!LOOPBACK_HOSTS.has(host)) return false;
  const port = url.port ? Number(url.port) : defaultPortForProtocol(url.protocol);
  return Number.isInteger(port) && allowedPorts.has(port);
}

function normalizeHostForComparison(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function defaultPortForProtocol(protocol: string): number {
  return ['https:', 'wss:'].includes(protocol) ? 443 : 80;
}

export {
  DEFAULT_VIEWPORT,
  MAX_SCREENSHOT_BYTES,
  MAX_SNAPSHOT_CHARS,
  assertUiSessionId,
  boundText,
  clampInteger,
  formatHost,
  isAllowedPageUrl,
  isAllowedResourceUrl,
  isAllowedSocketUrl,
  normalizeAllowedPorts,
  normalizeLoopbackHost,
  normalizePort,
  normalizeProtocol,
  normalizeUiRoute,
  normalizeViewport,
  normalizeWaitState,
  resolveUiRoute,
  sanitizeUiUrl,
  timeoutFor
};
