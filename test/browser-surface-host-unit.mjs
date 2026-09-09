import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createBrowserSurfaceHost } from '../electron/browser-surface-host.js';

let nextWebContentsId = 100;

class FakeSession extends EventEmitter {
  constructor() {
    super();
    this.storageCleared = 0;
    this.cacheCleared = 0;
    this.certificateVerifier = undefined;
  }
  setPermissionRequestHandler(handler) { this.permissionRequestHandler = handler; }
  setPermissionCheckHandler(handler) { this.permissionCheckHandler = handler; }
  setCertificateVerifyProc(handler) { this.certificateVerifier = handler; }
  async clearStorageData() { this.storageCleared += 1; }
  async clearCache() { this.cacheCleared += 1; }
}

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.id = nextWebContentsId++;
    this.url = 'about:blank';
    this.title = '';
    this.destroyed = false;
    this.focusCount = 0;
    this.executeJavaScriptError = null;
    this.onExecuteJavaScript = null;
  }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  getURL() { return this.url; }
  getTitle() { return this.title; }
  async loadURL(url) {
    this.emit('did-start-loading');
    this.url = url;
    this.title = 'Loaded';
    this.emit('did-navigate');
    this.emit('did-stop-loading');
  }
  stop() {}
  async executeJavaScript(script) {
    this.onExecuteJavaScript?.();
    if (this.executeJavaScriptError) throw this.executeJavaScriptError;
    if (String(script).includes('return { attached:')) return { attached: true, visible: true };
    return true;
  }
  focus() { this.focusCount += 1; }
  isDestroyed() { return this.destroyed; }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('destroyed');
  }
  destroy() { this.close(); }
}

class FakeWebContentsView {
  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
    this.bounds = null;
  }
  setBounds(bounds) { this.bounds = bounds; }
}

function createHarness({ failOpen = false } = {}) {
  const sessions = [];
  const views = [];
  const webContents = [];
  const HarnessWebContentsView = class extends FakeWebContentsView {
    constructor(options) {
      super(options);
      views.push(this);
      webContents.push(this.webContents);
    }
  };
  const sessionApi = {
    fromPartition() { const value = new FakeSession(); sessions.push(value); return value; },
    fromPath() { const value = new FakeSession(); sessions.push(value); return value; }
  };
  const childViews = new Set();
  const sent = [];
  const dashboard = {
    isDestroyed: () => false,
    contentView: {
      addChildView(view) { childViews.add(view); },
      removeChildView(view) { childViews.delete(view); }
    },
    webContents: { send: (...args) => sent.push(args) }
  };
  const routes = [];
  const events = [];
  const host = createBrowserSurfaceHost({
    WebContentsView: HarnessWebContentsView,
    session: sessionApi,
    getDashboardWindow: () => dashboard,
    openDashboard: async route => {
      routes.push(route);
      if (failOpen) throw new Error('dashboard unavailable');
    },
    onEvent: event => events.push(event)
  });
  return { host, sessions, views, webContents, childViews, routes, sent, events };
}

{
  const { host } = createHarness({ failOpen: true });
  await assert.rejects(() => host.run({ action: 'start' }), /dashboard unavailable/);
  assert.equal(host.getState().active, false, 'a failed dashboard handoff must not leave a hidden native browser session active');
}

{
  const { host, sessions, views, childViews, routes, events } = createHarness();
  const started = await host.run({ action: 'start' });
  assert.deepEqual(routes, ['#browser']);
  const opened = await host.run({ action: 'open_page', nativeSessionId: started.nativeSessionId });
  assert.equal(
    views[0].options.webPreferences.backgroundThrottling,
    undefined,
    'embedded browser views must not disable background throttling while the dashboard can still be hidden'
  );
  const secondTab = await host.run({ action: 'open_page', nativeSessionId: started.nativeSessionId });
  host.setBounds({ visible: true, x: 12, y: 34, width: 900, height: 600 });
  assert.equal(host.getState().visible, true);
  assert.equal(childViews.size, 1, 'the active page must be attached to the dashboard native content view');
  assert.equal(host.getState().tabs.length, 2, 'browser state must expose every open tab in the visible session');
  assert.equal(host.getState().nativePageId, secondTab.nativePageId, 'the newest tab should be active after opening');
  host.selectTab(opened.nativePageId);
  assert.equal(host.getState().nativePageId, opened.nativePageId, 'selecting a tab should swap the attached native view');
  assert.equal(host.getState().tabs.find(tab => tab.nativePageId === opened.nativePageId)?.active, true);
  await host.closeTab(secondTab.nativePageId);
  assert.equal(host.getState().tabs.length, 1, 'closing a tab from the desktop UI should remove it from browser state');
  assert.equal(events.at(-1)?.type, 'page_closed', 'desktop tab close must emit the canonical native page lifecycle event');
  assert.equal(events.at(-1)?.nativePageId, secondTab.nativePageId);

  host.setControl('user');
  assert.equal(host.getState().control, 'user');
  await assert.rejects(
    () => host.run({ action: 'navigate', nativeSessionId: started.nativeSessionId, nativePageId: opened.nativePageId, url: 'https://example.test/' }),
    error => error?.code === 'BROWSER_USER_CONTROL_ACTIVE'
  );
  await assert.rejects(
    () => host.run({ action: 'close_page', nativeSessionId: started.nativeSessionId, nativePageId: opened.nativePageId }),
    error => error?.code === 'BROWSER_USER_CONTROL_ACTIVE',
    'AI tool calls must not close a page while the user owns the browser session'
  );
  await assert.rejects(
    () => host.run({ action: 'close_session', nativeSessionId: started.nativeSessionId }),
    error => error?.code === 'BROWSER_USER_CONTROL_ACTIVE',
    'AI tool calls must not close a session while the user owns the browser session'
  );
  assert.equal((await host.run({ action: 'describe', nativeSessionId: started.nativeSessionId, nativePageId: opened.nativePageId })).url, 'about:blank');

  const concurrent = await host.run({ action: 'start', viewport: { width: 640, height: 480 } });
  const concurrentPage = await host.run({ action: 'open_page', nativeSessionId: concurrent.nativeSessionId });
  assert.equal(host.getState().sessions.length, 2, 'desktop browser state must expose all concurrent sessions for inspection');
  assert.equal(host.getState().sessions.filter(session => session.active).length, 1);
  await host.run({ action: 'navigate', nativeSessionId: concurrent.nativeSessionId, nativePageId: concurrentPage.nativePageId, url: 'https://background.example.test/' });
  assert.equal(host.getState().nativeSessionId, started.nativeSessionId, 'user takeover must pin the visible browser surface while other AI sessions continue');
  assert.equal(host.getState().control, 'user');
  assert.equal(childViews.size, 1, 'only the user-controlled browser view should remain attached during takeover');

  host.setControl('ai');
  assert.equal(host.getState().nativeSessionId, concurrent.nativeSessionId, 'returning control should reveal the most recently active AI session');
  host.selectSession(started.nativeSessionId);
  assert.equal(host.getState().nativeSessionId, started.nativeSessionId, 'the user must be able to choose which concurrent browser session to inspect');
  host.selectSession(concurrent.nativeSessionId);
  const navigated = await host.run({ action: 'navigate', nativeSessionId: started.nativeSessionId, nativePageId: opened.nativePageId, url: 'https://example.test/' });
  assert.equal(navigated.url, 'https://example.test/');

  await host.closeAll();
  assert.equal(host.getState().active, false);
  assert.deepEqual(host.getState().sessions, []);
  assert.equal(childViews.size, 0);
  assert.equal(sessions[0].storageCleared, 1, 'ephemeral browser storage must be cleared on session close');
  assert.equal(sessions[0].cacheCleared, 1, 'ephemeral browser cache must be cleared on session close');
  assert.equal(sessions[1].storageCleared, 1, 'concurrent ephemeral browser storage must also be cleared');
  assert.equal(sessions[1].cacheCleared, 1, 'concurrent ephemeral browser cache must also be cleared');
}

{
  const { host, webContents } = createHarness();
  const started = await host.run({ action: 'start' });
  const opened = await host.run({ action: 'open_page', nativeSessionId: started.nativeSessionId });
  webContents[0].executeJavaScriptError = new Error('download click failed');
  const unhandled = [];
  const onUnhandledRejection = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    await assert.rejects(
      () => host.run({
        action: 'begin_download',
        nativeSessionId: started.nativeSessionId,
        nativePageId: opened.nativePageId,
        interaction: 'click',
        target: { by: 'text', value: 'Download', exact: true },
        timeoutMs: 1_000
      }),
      /download click failed/
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'a failed download click must not emit a second unhandled rejection');
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    await host.closeAll();
  }
}

{
  const { host, sessions, webContents } = createHarness();
  const started = await host.run({ action: 'start' });
  const opened = await host.run({ action: 'open_page', nativeSessionId: started.nativeSessionId });
  let signalInteractionStarted;
  const interactionStarted = new Promise(resolve => { signalInteractionStarted = resolve; });
  webContents[0].onExecuteJavaScript = signalInteractionStarted;
  const downloadPromise = host.run({
    action: 'begin_download',
    nativeSessionId: started.nativeSessionId,
    nativePageId: opened.nativePageId,
    interaction: 'click',
    target: { by: 'text', value: 'Download', exact: true },
    timeoutMs: 1_000
  });
  const cancelledDownload = assert.rejects(
    downloadPromise,
    error => error?.code === 'BROWSER_OPERATION_CANCELLED'
  );
  await interactionStarted;

  const item = new EventEmitter();
  let cancelCount = 0;
  let prevented = false;
  item.getFilename = () => 'report.txt';
  item.setSavePath = value => { item.savePath = value; };
  item.cancel = () => { cancelCount += 1; };
  sessions[0].emit('will-download', { preventDefault: () => { prevented = true; } }, item, webContents[0]);
  assert.equal(prevented, false, 'a tracked download should be accepted');
  assert.ok(item.savePath, 'a tracked download should receive a temporary save path');

  await host.run({ action: 'close_page', nativeSessionId: started.nativeSessionId, nativePageId: opened.nativePageId });
  assert.equal(cancelCount, 1, 'closing a page must cancel a download that already started');
  await cancelledDownload;
  await host.closeAll();
}

console.log('Embedded browser surface lifecycle, attachment, takeover, downloads, and cleanup passed.');
