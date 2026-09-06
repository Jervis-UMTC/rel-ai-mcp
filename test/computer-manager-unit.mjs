import assert from 'node:assert/strict';

import { readComputerStatus, runComputerAction } from '../src/computerManager.js';
import { getToolActionCatalog } from '../src/tools/actionCatalog.js';
import { serializeToolError } from '../src/tools/errors.js';

const workspace = { alias: 'repo' };
const enabledConfig = { computerControl: { enabled: true } };
const disabledConfig = { computerControl: { enabled: false } };
const calls = [];
const MAX_TYPE_TEXT_BYTES = 64 * 1024;

const adapter = {
  engine: '@midscene/computer',
  environment: async () => ({ available: true, platform: process.platform, displays: 2 }),
  listDisplays: async () => [
    { id: 'display-side', name: 'Side', primary: false, coordinateSpace: 'display-local-pixels' },
    { id: 'display-main', name: 'Main', primary: true, coordinateSpace: 'display-local-pixels' }
  ],
  size: async displayId => displayId === 'display-side' ? { width: 1280, height: 1024 } : { width: 1920, height: 1080 },
  screenshot: async displayId => ({
    mimeType: 'image/png', data: Buffer.from(`shot:${displayId || 'primary'}`).toString('base64'),
    bytes: 10, width: displayId === 'display-side' ? 1280 : 1920, height: displayId === 'display-side' ? 1024 : 1080
  }),
  move: async (displayId, point) => calls.push(['move', displayId, point]),
  click: async (displayId, point) => calls.push(['click', displayId, point]),
  doubleClick: async (displayId, point) => calls.push(['doubleClick', displayId, point]),
  rightClick: async (displayId, point) => calls.push(['rightClick', displayId, point]),
  drag: async (displayId, from, to) => calls.push(['drag', displayId, from, to]),
  scroll: async (displayId, param) => calls.push(['scroll', displayId, param]),
  typeText: async text => calls.push(['typeText', text]),
  pressKey: async key => calls.push(['pressKey', key])
};
const context = { computerAdapter: adapter };

const disabledStatus = await readComputerStatus(disabledConfig, context);
assert.equal(disabledStatus.ok, true);
assert.equal(disabledStatus.enabled, false);
assert.equal(disabledStatus.available, true);
assert.equal(disabledStatus.engine, '@midscene/computer');
assert.equal(disabledStatus.displays, 2);

await assert.rejects(
  () => runComputerAction(workspace, disabledConfig, { action: 'screenshot' }, context),
  error => {
    assert.equal(error.code, 'COMPUTER_CONTROL_DISABLED');
    assert.equal(error.retryable, false);
    assert.equal(error.requiresUserConfirmation, false);
    assert.match(error.message, /Do not retry this computer action or request MCP approval/i);
    const serialized = serializeToolError('relai_computer', error);
    assert.equal(serialized.errorCode, 'COMPUTER_CONTROL_DISABLED');
    assert.equal(serialized.errorDetails.retryable, false);
    assert.equal(serialized.errorDetails.requiresUserConfirmation, false);
    assert.deepEqual(serialized.errorDetails.allowedAlternatives, [
      'Enable Computer control in Rel.AI Settings > App, then retry the requested computer action.'
    ]);
    return true;
  }
);

const displays = await runComputerAction(workspace, enabledConfig, { action: 'displays' }, context);
assert.equal(displays.count, 2);
assert.equal(displays.engine, '@midscene/computer');
assert.equal(displays.displays[0].coordinateSpace, 'display-local-pixels');
assert.equal(displays.displays[1].primary, true);

const capture = await runComputerAction(workspace, enabledConfig, { action: 'screenshot', displayId: 'display-side' }, context);
assert.equal(capture.displayId, 'display-side');
assert.equal(capture.image.mimeType, 'image/png');
assert.equal(capture.image.width, 1280);
assert.equal(capture.image.height, 1024);

calls.length = 0;
await runComputerAction(workspace, enabledConfig, { action: 'click', displayId: 'display-side', x: 100, y: 50 }, context);
await runComputerAction(workspace, enabledConfig, { action: 'move', x: 20, y: 30 }, context);
await runComputerAction(workspace, enabledConfig, { action: 'double_click', x: 25, y: 35 }, context);
await runComputerAction(workspace, enabledConfig, { action: 'right_click', x: 30, y: 40 }, context);
await runComputerAction(workspace, enabledConfig, { action: 'drag', x: 10, y: 20, toX: 30, toY: 40 }, context);
assert.deepEqual(calls, [
  ['click', 'display-side', { x: 100, y: 50 }],
  ['move', undefined, { x: 20, y: 30 }],
  ['doubleClick', undefined, { x: 25, y: 35 }],
  ['rightClick', undefined, { x: 30, y: 40 }],
  ['drag', undefined, { x: 10, y: 20 }, { x: 30, y: 40 }]
]);

calls.length = 0;
await runComputerAction(workspace, enabledConfig, { action: 'scroll', direction: 'down', distance: 125, x: 200, y: 300 }, context);
await runComputerAction(workspace, enabledConfig, { action: 'type', text: 'hello' }, context);
await runComputerAction(workspace, enabledConfig, { action: 'key', key: 'return' }, context);
await runComputerAction(workspace, enabledConfig, { action: 'hotkey', keys: ['ctrl', 's'] }, context);
assert.deepEqual(calls, [
  ['scroll', undefined, { direction: 'down', distance: 125, point: { x: 200, y: 300 } }],
  ['typeText', 'hello'],
  ['pressKey', 'enter'],
  ['pressKey', 'control+s']
]);

calls.length = 0;
await assert.rejects(
  () => runComputerAction(workspace, enabledConfig, { action: 'type', text: 'x'.repeat(MAX_TYPE_TEXT_BYTES + 1) }, context),
  /65536-byte limit/
);
assert.equal(calls.length, 0, 'oversized typing must be rejected before Midscene input execution');
const typeAction = getToolActionCatalog().find(entry => entry.publicTool === 'relai_computer' && entry.action === 'type');
assert.equal(typeAction?.inputSchema?.properties?.text?.maxLength, 65536, 'the model-facing schema must advertise the bounded typing limit');

await assert.rejects(
  () => runComputerAction(workspace, enabledConfig, { action: 'click', displayId: 'display-side', x: 1280, y: 20 }, context),
  /must be inside display 'display-side'/
);
await assert.rejects(
  () => runComputerAction(workspace, enabledConfig, { action: 'click', x: -1, y: 20 }, context),
  /must be between 0 and 100000/
);

const unavailable = await readComputerStatus(enabledConfig, {
  computerAdapter: { ...adapter, environment: async () => ({ available: false, platform: process.platform, displays: 0, error: 'permission denied' }) }
});
assert.equal(unavailable.available, false);
assert.match(unavailable.message, /permission denied/);

console.log('Computer manager preserves Rel.AI opt-in policy and bounds while delegating display-local input, screenshots, typing, and hotkeys to the Midscene adapter.');
