import assert from 'node:assert/strict';

import { createMidsceneComputerAdapter } from '../src/computer/midsceneAdapter.js';

const calls = [];
const instances = [];
const screenshotBytes = Buffer.from('midscene-shot');

class FakeComputerDevice {
  static async listDisplays() {
    calls.push(['listDisplays']);
    return [
      { id: 'main', name: 'Main', primary: true },
      { id: 'side', name: 'Side', primary: false }
    ];
  }

  constructor(options) {
    this.displayId = options?.displayId;
    instances.push(this);
    calls.push(['construct', this.displayId]);
    this.inputPrimitives = {
      pointer: {
        hover: async point => calls.push(['hover', this.displayId, point]),
        tap: async point => calls.push(['tap', this.displayId, point]),
        doubleClick: async point => calls.push(['doubleClick', this.displayId, point]),
        rightClick: async point => calls.push(['rightClick', this.displayId, point]),
        dragAndDrop: async (from, to) => calls.push(['dragAndDrop', this.displayId, from, to])
      },
      scroll: {
        scroll: async value => calls.push(['scroll', this.displayId, value])
      },
      keyboard: {
        typeText: async (text, options) => calls.push(['typeText', this.displayId, text, options]),
        keyboardPress: async key => calls.push(['keyboardPress', this.displayId, key])
      }
    };
  }

  async connect() {
    calls.push(['connect', this.displayId]);
  }

  async destroy() {
    calls.push(['destroy', this.displayId]);
  }

  async size() {
    calls.push(['size', this.displayId]);
    return this.displayId === 'side' ? { width: 1280, height: 1024 } : { width: 1920, height: 1080 };
  }

  async screenshotBase64() {
    calls.push(['screenshotBase64', this.displayId]);
    return `data:image/png;base64,${screenshotBytes.toString('base64')}`;
  }
}

const fakeModule = {
  ComputerDevice: FakeComputerDevice,
  checkComputerEnvironment: async () => ({ available: true, platform: 'win32', displays: 2 })
};
const adapter = createMidsceneComputerAdapter({ importMidscene: async () => fakeModule });

assert.equal(adapter.engine, '@midscene/computer');
assert.deepEqual(await adapter.environment(), { available: true, platform: 'win32', displays: 2 });
assert.deepEqual(await adapter.listDisplays(), [
  { id: 'main', name: 'Main', primary: true, coordinateSpace: 'display-local-pixels' },
  { id: 'side', name: 'Side', primary: false, coordinateSpace: 'display-local-pixels' }
]);

calls.length = 0;
assert.deepEqual(await adapter.size('side'), { width: 1280, height: 1024 });
await adapter.click('side', { x: 10, y: 20 });
await adapter.move('side', { x: 11, y: 21 });
await adapter.doubleClick('side', { x: 12, y: 22 });
await adapter.rightClick('side', { x: 13, y: 23 });
await adapter.drag('side', { x: 1, y: 2 }, { x: 3, y: 4 });
await adapter.scroll('side', { direction: 'down', distance: 240, point: { x: 50, y: 60 } });
assert.equal(calls.filter(call => call[0] === 'construct' && call[1] === 'side').length, 1, 'one Midscene device must be reused per display');
assert.equal(calls.filter(call => call[0] === 'connect' && call[1] === 'side').length, 1, 'cached display devices must connect only once');
assert.deepEqual(calls.find(call => call[0] === 'scroll'), [
  'scroll', 'side', { scrollType: 'singleAction', direction: 'down', distance: 240, locate: { center: [50, 60] } }
]);

calls.length = 0;
await adapter.typeText('hello');
await adapter.pressKey('control+s');
assert.deepEqual(calls.filter(call => ['typeText', 'keyboardPress'].includes(call[0])), [
  ['typeText', undefined, 'hello', { replace: false }],
  ['keyboardPress', undefined, 'control+s']
]);
assert.equal(calls.filter(call => call[0] === 'construct' && call[1] === undefined).length, 1, 'primary Midscene device must be cached');

calls.length = 0;
const image = await adapter.screenshot('side');
assert.equal(image.mimeType, 'image/png');
assert.equal(image.data, screenshotBytes.toString('base64'));
assert.equal(image.bytes, screenshotBytes.length);
assert.equal(image.width, 1280);
assert.equal(image.height, 1024);
await adapter.screenshot('side');
assert.equal(calls.filter(call => call[0] === 'screenshotBase64' && call[1] === 'side').length, 1, 'repeated observation may reuse the short screenshot cache');
await adapter.screenshot('side', { fresh: true });
assert.equal(calls.filter(call => call[0] === 'screenshotBase64' && call[1] === 'side').length, 2, 'fresh observation must bypass the short screenshot cache for local change detection');
await adapter.click('side', { x: 20, y: 30 });
await adapter.screenshot('side');
assert.equal(calls.filter(call => call[0] === 'screenshotBase64' && call[1] === 'side').length, 3, 'display input must invalidate the cached screenshot immediately');

calls.length = 0;
await adapter.screenshot();
await adapter.screenshot();
assert.equal(calls.filter(call => call[0] === 'screenshotBase64' && call[1] === undefined).length, 1);
await adapter.typeText('invalidate-primary');
await adapter.screenshot();
assert.equal(calls.filter(call => call[0] === 'screenshotBase64' && call[1] === undefined).length, 2, 'keyboard input must invalidate the primary screenshot cache');

const tooLargeModule = {
  ...fakeModule,
  ComputerDevice: class extends FakeComputerDevice {
    async screenshotBase64() {
      return `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}`;
    }
  }
};
const boundedAdapter = createMidsceneComputerAdapter({ importMidscene: async () => tooLargeModule });
await assert.rejects(() => boundedAdapter.screenshot(), /4194304-byte image limit/);

let attempts = 0;
class FailingOnceDevice extends FakeComputerDevice {
  async connect() {
    attempts += 1;
    if (attempts === 1) throw new Error('connect failed');
  }
}
const retryingAdapter = createMidsceneComputerAdapter({
  importMidscene: async () => ({ ...fakeModule, ComputerDevice: FailingOnceDevice })
});
await assert.rejects(() => retryingAdapter.size('side'), /connect failed/);
assert.deepEqual(await retryingAdapter.size('side'), { width: 1280, height: 1024 }, 'failed device connections must be evicted so a later action can retry');

assert.ok(instances.length >= 2);
console.log('Midscene computer adapter caches connected devices, invalidates screenshots after input, preserves bounded screenshots, and retries failed device initialization.');
