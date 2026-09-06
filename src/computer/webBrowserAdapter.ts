import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { taskError } from '../toolActivity.js';
import {
  DEFAULT_VIEWPORT,
  MAX_SCREENSHOT_BYTES,
  MAX_SNAPSHOT_CHARS,
  boundText,
  clampInteger,
  isAllowedPageUrl,
  isAllowedResourceUrl,
  isAllowedSocketUrl,
  normalizeWaitState,
  sanitizeUiUrl
} from './webPolicy.ts';

const MAX_LOG_ENTRIES = 300;

type BrowserEntry = Record<string, unknown>;
type Viewport = Readonly<{ width: number; height: number }>;

type UiTarget = Readonly<{
  by?: unknown;
  value?: unknown;
  name?: unknown;
  exact?: unknown;
  index?: unknown;
}>;

type BrowserInteractionArgs = Readonly<{
  interaction?: unknown;
  target?: UiTarget;
  input?: unknown;
  key?: unknown;
  selectValue?: unknown;
  state?: unknown;
}>;

interface LaunchWebBrowserOptions {
  readonly protocol: 'http' | 'https';
  readonly viewport: Viewport;
  readonly headless: boolean;
  readonly allowedPorts: ReadonlySet<number>;
}

interface BrowserActionResult extends Record<string, unknown> {
  readonly url: string;
}

interface WebBrowserSession {
  readonly browserProduct: string;
  readonly viewport: Viewport;
  navigate(targetUrl: string, timeoutMs: number): Promise<BrowserActionResult>;
  reload(timeoutMs: number): Promise<BrowserActionResult>;
  snapshot(timeoutMs: number): Promise<BrowserActionResult>;
  interact(args: BrowserInteractionArgs, timeoutMs: number): Promise<BrowserActionResult>;
  screenshot(fullPage: boolean): Promise<BrowserActionResult>;
  setViewport(viewport: Viewport): Promise<BrowserActionResult>;
  readEntries(kind: 'console' | 'network', maxEntries: unknown, clear: boolean): BrowserActionResult;
  close(): Promise<void>;
  onDisconnected(listener: () => void): void;
}

async function launchWebBrowserSession(options: LaunchWebBrowserOptions): Promise<WebBrowserSession> {
  const runtime = resolveChromiumRuntime();
  const consoleEntries: BrowserEntry[] = [];
  const networkEntries: BrowserEntry[] = [];
  let browser: Browser | undefined;
  let browserContext: BrowserContext | undefined;

  try {
    browser = await chromium.launch({
      headless: options.headless,
      executablePath: runtime.executablePath
    });
    browserContext = await browser.newContext({
      viewport: options.viewport,
      ignoreHTTPSErrors: options.protocol === 'https',
      serviceWorkers: 'block'
    });
    await installNetworkBoundary(browserContext, options.allowedPorts, networkEntries);
    const page = await browserContext.newPage();
    installPageDiagnostics(page, consoleEntries, networkEntries);

    return Object.freeze({
      browserProduct: runtime.product,
      viewport: options.viewport,
      navigate: async (targetUrl: string, timeoutMs: number) => {
        const navigation = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        assertCurrentPageAllowed(page, options.allowedPorts);
        return pageResult(page, { statusCode: navigation?.status() ?? null, title: await safeTitle(page) });
      },
      reload: async (timeoutMs: number) => {
        const navigation = await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
        assertCurrentPageAllowed(page, options.allowedPorts);
        return pageResult(page, { statusCode: navigation?.status() ?? null, title: await safeTitle(page) });
      },
      snapshot: async (timeoutMs: number) => {
        const yaml = await page.locator('body').ariaSnapshot({ timeout: timeoutMs });
        const bounded = boundText(yaml, MAX_SNAPSHOT_CHARS);
        return pageResult(page, { title: await safeTitle(page), snapshot: bounded.text, truncated: bounded.truncated });
      },
      interact: async (args: BrowserInteractionArgs, timeoutMs: number) => {
        const interaction = String(args.interaction || '').trim();
        const locator = targetLocator(page, args.target);
        switch (interaction) {
          case 'click':
            await locator.click({ timeout: timeoutMs });
            break;
          case 'fill':
            await locator.fill(String(args.input ?? ''), { timeout: timeoutMs });
            break;
          case 'press':
            if (!String(args.key || '').trim()) throw new Error('interact press requires key.');
            await locator.press(String(args.key), { timeout: timeoutMs });
            break;
          case 'select':
            if (args.selectValue == null) throw new Error('interact select requires selectValue.');
            await locator.selectOption(String(args.selectValue), { timeout: timeoutMs });
            break;
          case 'hover':
            await locator.hover({ timeout: timeoutMs });
            break;
          case 'wait':
            await locator.waitFor({ state: normalizeWaitState(args.state), timeout: timeoutMs });
            break;
          default:
            throw new Error(`Unsupported UI interaction '${interaction || '(missing)'}.`);
        }
        assertCurrentPageAllowed(page, options.allowedPorts);
        return pageResult(page, { interaction, target: publicTarget(args.target), title: await safeTitle(page) });
      },
      screenshot: async (fullPage: boolean) => {
        const buffer = await page.screenshot({ type: 'png', fullPage, animations: 'disabled' });
        if (buffer.length > MAX_SCREENSHOT_BYTES) {
          throw new Error(`UI screenshot is ${buffer.length} bytes; the limit is ${MAX_SCREENSHOT_BYTES} bytes. Use the current viewport instead of fullPage.`);
        }
        const viewport = page.viewportSize() || DEFAULT_VIEWPORT;
        return pageResult(page, {
          title: await safeTitle(page),
          viewport,
          image: {
            mimeType: 'image/png',
            data: buffer.toString('base64'),
            bytes: buffer.length,
            width: viewport.width,
            height: viewport.height,
            fullPage
          }
        });
      },
      setViewport: async (viewport: Viewport) => {
        await page.setViewportSize(viewport);
        return pageResult(page, { viewport });
      },
      readEntries: (kind: 'console' | 'network', maxEntries: unknown, clear: boolean) => {
        const source = kind === 'console' ? consoleEntries : networkEntries;
        const limit = clampInteger(maxEntries, 1, 200, 100);
        const entries = source.slice(-limit);
        if (clear) source.length = 0;
        return pageResult(page, {
          ...(kind === 'console' ? { consoleEntries: entries } : { networkEntries: entries }),
          count: entries.length,
          cleared: clear
        });
      },
      close: async () => {
        const failures: unknown[] = [];
        await browserContext?.close().catch(error => failures.push(error));
        await browser?.close().catch(error => failures.push(error));
        if (failures.length) throw new Error(failures.map(errorMessage).join('; '));
      },
      onDisconnected: (listener: () => void) => browser?.once('disconnected', listener)
    });
  } catch (error) {
    await browserContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
    throw error;
  }
}

async function installNetworkBoundary(
  browserContext: BrowserContext,
  allowedPorts: ReadonlySet<number>,
  networkEntries: BrowserEntry[]
): Promise<void> {
  await browserContext.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (isAllowedResourceUrl(url, allowedPorts)) {
      await route.continue();
      return;
    }
    pushEntry(networkEntries, {
      type: 'blocked',
      method: request.method(),
      url: sanitizeUiUrl(url),
      reason: 'outside_allowed_loopback_ports'
    });
    await route.abort('blockedbyclient');
  });
  await browserContext.routeWebSocket(() => true, async webSocket => {
    const url = webSocket.url();
    if (isAllowedSocketUrl(url, allowedPorts)) {
      await webSocket.connectToServer();
      return;
    }
    pushEntry(networkEntries, {
      type: 'blocked_websocket',
      url: sanitizeUiUrl(url),
      reason: 'outside_allowed_loopback_ports'
    });
    await webSocket.close({ code: 1008, reason: 'Rel.AI local UI boundary' });
  });
}

function installPageDiagnostics(page: Page, consoleEntries: BrowserEntry[], networkEntries: BrowserEntry[]): void {
  page.on('console', message => pushEntry(consoleEntries, {
    type: message.type(),
    text: boundText(message.text(), 4000).text,
    url: sanitizeUiUrl(message.location()?.url || '')
  }));
  page.on('pageerror', error => pushEntry(consoleEntries, {
    type: 'pageerror',
    text: boundText(error?.message || String(error), 4000).text
  }));
  page.on('requestfailed', request => pushEntry(networkEntries, {
    type: 'requestfailed',
    method: request.method(),
    url: sanitizeUiUrl(request.url()),
    error: boundText(request.failure()?.errorText || 'request failed', 1000).text
  }));
  page.on('response', response => {
    if (response.status() < 400) return;
    pushEntry(networkEntries, {
      type: 'http_error',
      method: response.request().method(),
      statusCode: response.status(),
      url: sanitizeUiUrl(response.url())
    });
  });
}

function targetLocator(page: Page, target: UiTarget | undefined): Locator {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('interact requires target.');
  const by = String(target.by || '').trim();
  const value = String(target.value || '');
  if (!value) throw new Error('target.value is required.');
  const exact = target.exact === true;
  let locator: Locator;
  switch (by) {
    case 'role': locator = page.getByRole(value as never, target.name ? { name: String(target.name), exact } : {}); break;
    case 'text': locator = page.getByText(value, { exact }); break;
    case 'label': locator = page.getByLabel(value, { exact }); break;
    case 'placeholder': locator = page.getByPlaceholder(value, { exact }); break;
    case 'testid': locator = page.getByTestId(value); break;
    case 'css': locator = page.locator(value); break;
    default: throw new Error(`Unsupported target.by '${by || '(missing)'}.`);
  }
  const index = Number(target.index);
  if (Number.isInteger(index) && index >= 0) locator = locator.nth(index);
  return locator;
}

function publicTarget(target: UiTarget | undefined = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    by: target.by,
    value: target.value,
    name: target.name,
    exact: target.exact === true ? true : undefined,
    index: Number.isInteger(Number(target.index)) ? Number(target.index) : undefined
  }).filter(([, value]) => value !== undefined && value !== ''));
}

function pageResult(page: Page, extra: Record<string, unknown> = {}): BrowserActionResult {
  return { url: sanitizeUiUrl(page.url()), ...extra };
}

function assertCurrentPageAllowed(page: Page, allowedPorts: ReadonlySet<number>): void {
  if (!isAllowedPageUrl(page.url(), allowedPorts)) {
    throw taskError('UI_NAVIGATION_BLOCKED', 'The page navigated outside the allowed local UI boundary.');
  }
}

function resolveChromiumRuntime(): { executablePath: string; product: string } {
  const override = String(process.env.REL_AI_UI_CHROMIUM_PATH || '').trim();
  if (override) {
    if (!isExecutableFile(override)) throw new Error('REL_AI_UI_CHROMIUM_PATH does not point to an available file.');
    return { executablePath: override, product: 'configured Chromium' };
  }
  for (const candidate of chromiumCandidates()) {
    if (isExecutableFile(candidate.executablePath)) return candidate;
  }
  throw taskError(
    'UI_RUNTIME_UNAVAILABLE',
    'No supported local Chromium runtime was found. Install Chrome, Edge, or Chromium, or set REL_AI_UI_CHROMIUM_PATH.'
  );
}

function chromiumCandidates(): Array<{ executablePath: string; product: string }> {
  const candidates: Array<{ executablePath: string; product: string }> = [];
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((value): value is string => Boolean(value));
    for (const root of roots) {
      candidates.push({ executablePath: path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), product: 'Microsoft Edge' });
      candidates.push({ executablePath: path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), product: 'Google Chrome' });
      candidates.push({ executablePath: path.join(root, 'Chromium', 'Application', 'chrome.exe'), product: 'Chromium' });
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', product: 'Google Chrome' },
      { executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', product: 'Microsoft Edge' },
      { executablePath: '/Applications/Chromium.app/Contents/MacOS/Chromium', product: 'Chromium' }
    );
  } else {
    for (const [name, product] of [
      ['google-chrome', 'Google Chrome'],
      ['google-chrome-stable', 'Google Chrome'],
      ['microsoft-edge', 'Microsoft Edge'],
      ['microsoft-edge-stable', 'Microsoft Edge'],
      ['chromium', 'Chromium'],
      ['chromium-browser', 'Chromium']
    ] as const) {
      const resolved = spawnSync('which', [name], { encoding: 'utf8', windowsHide: true });
      const executablePath = String(resolved.stdout || '').trim().split(/\r?\n/, 1)[0];
      if (executablePath) candidates.push({ executablePath, product });
    }
  }
  try {
    const bundled = chromium.executablePath();
    if (bundled) candidates.push({ executablePath: bundled, product: 'Chromium' });
  } catch {}
  return candidates;
}

function isExecutableFile(file: string): boolean {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

async function safeTitle(page: Page): Promise<string> {
  try { return boundText(await page.title(), 1000).text; } catch { return ''; }
}

function pushEntry(entries: BrowserEntry[], entry: BrowserEntry): void {
  entries.push({ at: new Date().toISOString(), ...entry });
  if (entries.length > MAX_LOG_ENTRIES) entries.splice(0, entries.length - MAX_LOG_ENTRIES);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

export { launchWebBrowserSession };
export type { BrowserActionResult, BrowserInteractionArgs, WebBrowserSession };
