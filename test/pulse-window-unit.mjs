import assert from 'node:assert/strict';

import { createPulseWindowManager, pulseBounds } from '../electron/pulse-window.js';
import { projectPulseStatus } from '../electron/pulse-state.js';

const waitingApproval = projectPulseStatus({
  serverRunning: true,
  tunnelStatus: 'running',
  taskActivity: {
    state: 'waiting', activeCalls: 0, activeTaskCount: 1,
    tasks: [{ taskId: 'task-1', workspace: 'repo', title: 'Ship release', status: 'waiting_for_approval' }]
  }
});
assert.equal(waitingApproval.actionRequired, true);
assert.equal(waitingApproval.badge, 'Action required');
assert.equal(waitingApproval.title, 'Approval required');
assert.match(waitingApproval.detail, /approval/i);
assert.match(waitingApproval.route, /^#tasks\?/);
assert.match(waitingApproval.route, /workspace=repo/);
assert.match(waitingApproval.route, /task=task-1/);

const blocked = projectPulseStatus({
  taskActivity: {
    state: 'waiting', activeCalls: 0, activeTaskCount: 1,
    tasks: [{ taskId: 'task-2', workspace: 'repo', status: 'blocked', currentActivity: 'Choose a valid deployment target.' }]
  }
});
assert.equal(blocked.actionRequired, true);
assert.equal(blocked.title, 'Resolve the blocker to continue');
assert.match(blocked.detail, /deployment target/i);

const validationFailed = projectPulseStatus({
  taskActivity: {
    state: 'waiting', activeCalls: 0, activeTaskCount: 1,
    tasks: [{ taskId: 'task-3', workspace: 'repo', status: 'validation_failed' }]
  }
});
assert.equal(validationFailed.actionRequired, true);
assert.equal(validationFailed.title, 'Checks need attention');

const working = projectPulseStatus({
  taskActivity: {
    state: 'working', activeCalls: 1, activeTaskCount: 2, operation: 'Running tests',
    tasks: [
      { taskId: 'task-4', workspace: 'repo', title: 'Fix tests', status: 'running', activeCalls: 1, progress: { percent: 42, label: 'Frontend tests' } },
      { taskId: 'task-4b', workspace: 'docs', title: 'Prepare notes', status: 'planning' }
    ]
  }
});
assert.equal(working.tone, 'working');
assert.equal(working.actionRequired, false);
assert.equal(working.badge, '1 running');
assert.equal(working.contextTitle, 'Fix tests');
assert.equal(working.workspace, 'repo');
assert.equal(working.progressPercent, 42);
assert.equal(working.progressLabel, 'Frontend tests');
assert.equal(working.otherTaskCount, 1);

const ordinaryWaiting = projectPulseStatus({
  taskActivity: {
    state: 'waiting', activeCalls: 0, activeTaskCount: 1,
    tasks: [{ taskId: 'task-5', workspace: 'repo', status: 'running', title: 'Continue task' }]
  }
});
assert.equal(ordinaryWaiting.tone, 'waiting');
assert.equal(ordinaryWaiting.actionRequired, false);
assert.doesNotMatch(ordinaryWaiting.detail, /waiting on you/i, 'ordinary remote reasoning gaps must not be mislabeled as user input');

const connectedIdle = projectPulseStatus({ serverRunning: true, tunnelStatus: 'running' });
assert.equal(connectedIdle.visible, false, 'Pulse must stay out of the way when Rel.AI is merely connected');
assert.equal(connectedIdle.tone, 'idle');
assert.equal(projectPulseStatus({ serverRunning: false }).visible, false);

const workArea = { x: 100, y: 50, width: 1400, height: 900 };
const displayListeners = new Map();
const fakeScreen = {
  getPrimaryDisplay: () => ({ workArea }),
  on(name, listener) { displayListeners.set(name, listener); },
  off(name, listener) { if (displayListeners.get(name) === listener) displayListeners.delete(name); }
};
assert.deepEqual(pulseBounds(fakeScreen), { x: 1196, y: 68, width: 286, height: 48 });
assert.deepEqual(pulseBounds(fakeScreen, { expanded: true }), { x: 1118, y: 68, width: 364, height: 288 });

const windows = [];
class FakeWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.visible = false;
    this.events = new Map();
    this.webContentsEvents = new Map();
    this.sent = [];
    this.boundsWrites = [];
    this.sessionEvents = new Map();
    this.session = {
      protocol: {},
      setPermissionRequestHandler: listener => { this.permissionRequest = listener; },
      setPermissionCheckHandler: listener => { this.permissionCheck = listener; },
      on: (name, listener) => this.sessionEvents.set(name, listener)
    };
    this.webContents = {
      session: this.session,
      on: (name, listener) => this.webContentsEvents.set(name, listener),
      setWindowOpenHandler: listener => { this.openHandler = listener; },
      send: (channel, payload) => this.sent.push({ channel, payload })
    };
    windows.push(this);
  }
  loadURL(url) { this.url = url; return Promise.resolve(); }
  on(name, listener) { this.events.set(name, listener); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; this.showInactiveCount = (this.showInactiveCount || 0) + 1; }
  show() { this.visible = true; this.showCount = (this.showCount || 0) + 1; }
  hide() { this.visible = false; this.hideCount = (this.hideCount || 0) + 1; }
  setBounds(bounds) { this.boundsWrites.push({ ...bounds }); }
  setSize(width, height) { this.sizeWrites = [...(this.sizeWrites || []), { width, height }]; }
  destroy() { this.destroyed = true; this.visible = false; this.events.get('closed')?.(); }
}

const securityErrors = [];
let protocolInstallCount = 0;
const manager = createPulseWindowManager({
  BrowserWindow: FakeWindow,
  screen: fakeScreen,
  preloadPath: 'preload.cjs',
  rendererUrl: 'relai-app://renderer/pulse.html',
  installProtocol: () => { protocolInstallCount += 1; },
  platform: 'win32',
  onSecurityError: error => securityErrors.push(error)
});
assert.equal(manager.start(), true);
assert.equal(manager.start(), false, 'Pulse startup must be idempotent');
manager.update({ serverRunning: true, tunnelStatus: 'running' });
assert.equal(manager.getWindow(), null, 'Connected idle state must not create a persistent overlay');
manager.update({
  serverRunning: true, tunnelStatus: 'running',
  taskActivity: {
    state: 'working', activeCalls: 1, activeTaskCount: 1, operation: 'Running tests',
    tasks: [{ taskId: 'task-active', workspace: 'repo', title: 'Fix tests', status: 'running', activeCalls: 1 }]
  }
});
const window = manager.getWindow();
assert.ok(window);
assert.equal(windows.length, 1);
assert.equal(protocolInstallCount, 1);
assert.equal(window.options.frame, false);
assert.equal(window.options.skipTaskbar, true);
assert.equal(window.options.alwaysOnTop, true);
assert.equal(window.options.transparent, true);
assert.equal(window.options.backgroundColor, '#00000000');
assert.equal(window.options.webPreferences.nodeIntegration, false);
assert.equal(window.options.webPreferences.contextIsolation, true);
assert.equal(window.options.webPreferences.sandbox, true);
assert.deepEqual(window.options.webPreferences.additionalArguments, ['--relai-preload-surface=pulse']);
assert.equal(window.showInactiveCount, 1, 'Pulse must appear without taking focus');
assert.equal(window.showCount || 0, 0, 'showInactive must not fall through to a focusable show call');
assert.equal(window.permissionCheck(), false);
assert.deepEqual(window.openHandler({ url: 'https://example.com' }), { action: 'deny' });
manager.setThemePreference('dark');
window.webContentsEvents.get('did-finish-load')?.();
assert.equal(window.sent.at(-1).channel, 'pulse:update');
assert.equal(window.sent.at(-1).payload.tone, 'working');
assert.equal(window.sent.at(-1).payload.themePreference, 'dark');
assert.equal(manager.setExpanded(true), true);
assert.deepEqual(window.boundsWrites.at(-1), pulseBounds(fakeScreen, { expanded: true }));
assert.equal(manager.setExpanded(false), false);
assert.deepEqual(window.boundsWrites.at(-1), pulseBounds(fakeScreen));

manager.update({
  serverRunning: true, tunnelStatus: 'running',
  taskActivity: {
    state: 'waiting', activeCalls: 0, activeTaskCount: 1,
    tasks: [{ taskId: 'task-action', workspace: 'repo', status: 'waiting_for_approval' }]
  }
});
assert.equal(window.sent.at(-1).payload.actionRequired, true);
manager.setEnabled(false);
assert.equal(window.visible, false);
manager.setEnabled(true);
assert.equal(window.visible, true);
displayListeners.get('display-metrics-changed')?.();
assert.deepEqual(window.boundsWrites.at(-1), pulseBounds(fakeScreen));
assert.equal(securityErrors.length, 0);
assert.equal(manager.stop(), true);
assert.equal(manager.stop(), false, 'Pulse shutdown must be idempotent');
assert.equal(manager.getWindow(), null);
assert.equal(displayListeners.size, 0);

const waylandWindows = [];
class WaylandWindow extends FakeWindow {
  constructor(options) { super(options); waylandWindows.push(this); }
}
const waylandManager = createPulseWindowManager({
  BrowserWindow: WaylandWindow,
  screen: fakeScreen,
  preloadPath: 'preload.cjs',
  rendererUrl: 'relai-app://renderer/pulse.html',
  platform: 'linux',
  env: { XDG_SESSION_TYPE: 'wayland' }
});
waylandManager.start();
waylandManager.update({
  taskActivity: {
    state: 'working', activeCalls: 1, activeTaskCount: 1,
    tasks: [{ taskId: 'task-wayland', status: 'running', activeCalls: 1 }]
  }
});
assert.equal(waylandWindows[0].options.alwaysOnTop, false, 'Wayland must not claim unsupported always-on-top behavior');
assert.equal(waylandWindows[0].boundsWrites.length, 0, 'Wayland must not issue unsupported global reposition requests');
waylandManager.setExpanded(true);
assert.deepEqual(waylandWindows[0].sizeWrites.at(-1), { width: 364, height: 288 }, 'Wayland may resize locally without claiming global positioning');
waylandManager.stop();

console.log('Rel.AI Pulse state projection, security, focus behavior, positioning, and Wayland fallback tests passed.');
