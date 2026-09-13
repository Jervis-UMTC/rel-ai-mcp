import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { taskError } from '../toolActivity.js';
import {
  MAX_SNAPSHOT_CHARS,
  boundText,
  clampInteger,
  isAllowedPageUrl,
  isAllowedResourceUrl,
  isAllowedSocketUrl,
  sanitizeUiUrl
} from './webPolicy.ts';
import {
  performStructuredInteraction,
  resolveChromiumRuntime,
  safeTitle,
  screenshotPage,
  type StructuredInteractionArgs
} from '../browser/playwrightPrimitives.ts';

const MAX_LOG_ENTRIES = 300;

type BrowserEntry = Record<string, unknown>;
type Viewport = Readonly<{ width: number; height: number }>;
type BrowserInteractionArgs = StructuredInteractionArgs;

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
  const runtime = resolveChromiumRuntime({
    overrideEnvironmentVariables: ['REL_AI_UI_CHROMIUM_PATH'],
    invalidOverrideMessage: 'REL_AI_UI_CHROMIUM_PATH does not point to an available file.',
    unavailableCode: 'UI_RUNTIME_UNAVAILABLE',
    unavailableMessage: 'No supported local Chromium runtime was found. Install Chrome, Edge, or Chromium, or set REL_AI_UI_CHROMIUM_PATH.'
  });
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
        const interaction = await performStructuredInteraction(page, args, timeoutMs, 'UI');
        assertCurrentPageAllowed(page, options.allowedPorts);
        return pageResult(page, { ...interaction, title: await safeTitle(page) });
      },
      screenshot: async (fullPage: boolean) => pageResult(page, {
        title: await safeTitle(page),
        ...(await screenshotPage(page, fullPage, 'UI screenshot'))
      }),
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

function pageResult(page: Page, extra: Record<string, unknown> = {}): BrowserActionResult {
  return { url: sanitizeUiUrl(page.url()), ...extra };
}

function assertCurrentPageAllowed(page: Page, allowedPorts: ReadonlySet<number>): void {
  if (!isAllowedPageUrl(page.url(), allowedPorts)) {
    throw taskError('UI_NAVIGATION_BLOCKED', 'The page navigated outside the allowed local UI boundary.');
  }
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
