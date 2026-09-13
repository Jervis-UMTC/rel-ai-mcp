import assert from 'node:assert/strict';

import { createWindowsUiaAdapter } from '../src/computer/windowsUiaAdapter.js';

const target = {
  targetId: 'e1', source: 'uia', role: 'Button', name: 'Save', automationId: 'save', className: 'Button', enabled: true,
  displayId: '\\\\.\\DISPLAY1', x: 100, y: 200, width: 80, height: 30, centerX: 140, centerY: 215, patterns: ['invoke']
};
let requests = [];
const adapter = createWindowsUiaAdapter({
  platform: 'win32',
  request: async payload => {
    requests.push(payload);
    if (payload.action === 'warmup') return { supported: true, available: true, ocrAvailable: true };
    if (payload.action === 'activate') {
      return { supported: true, available: true, handled: true, method: 'uia-invoke', target };
    }
    if (payload.action === 'set_value') {
      return { supported: true, available: true, handled: true, method: 'uia-set-value', target: { ...target, role: 'Edit', patterns: ['value'] } };
    }
    return {
      supported: true,
      available: true,
      perception: payload.perception,
      ocrAvailable: true,
      window: {
        title: 'Notes',
        processName: 'notes',
        processId: 123,
        className: 'NotesWindow',
        displayId: '\\\\.\\DISPLAY1'
      },
      elements: [
        target,
        {
          targetId: 'e2', source: 'ocr', role: 'Text', name: 'Export report', automationId: '', className: 'Windows.Media.Ocr', enabled: true,
          displayId: '\\\\.\\DISPLAY1', x: 200, y: 300, width: 120, height: 30, centerX: 260, centerY: 315
        },
        { targetId: '', role: 'Button', displayId: '', width: 0, height: 0 }
      ],
      count: 3,
      truncated: false
    };
  }
});

assert.equal(adapter.supported(), true);
const warm = await adapter.warmup();
assert.equal(warm.available, true);
assert.equal(warm.ocrAvailable, true);
await adapter.warmup();
assert.deepEqual(requests, [{ action: 'warmup' }], 'warmup must be shared instead of spawning duplicate initialization work');

const observation = await adapter.observe('Notes', 50, 'hybrid');
assert.deepEqual(requests.at(-1), { action: 'observe', app: 'Notes', maxElements: 50, perception: 'hybrid' });
assert.equal(observation.available, true);
assert.equal(observation.perception, 'hybrid');
assert.equal(observation.ocrAvailable, true);
assert.equal(observation.count, 2, 'malformed semantic targets must be filtered at the adapter boundary');
assert.equal(observation.elements[0].targetId, 'e1');
assert.equal(observation.elements[0].source, 'uia');
assert.deepEqual(observation.elements[0].patterns, ['invoke']);
assert.equal(observation.elements[0].centerX, 140);
assert.equal(observation.elements[1].source, 'ocr');
assert.equal(observation.window.processName, 'notes');

const activation = await adapter.activate('Notes', observation.elements[0], 50, 'hybrid');
assert.equal(activation.available, true);
assert.equal(activation.handled, true);
assert.equal(activation.method, 'uia-invoke');
assert.equal(activation.target.source, 'uia');
assert.equal(requests.at(-1).action, 'activate');
assert.equal(requests.at(-1).perception, 'hybrid');
assert.equal(requests.at(-1).target.targetId, 'e1');

const setValue = await adapter.setValue('Notes', observation.elements[0], '', 50);
assert.equal(setValue.handled, true);
assert.equal(setValue.method, 'uia-set-value');
assert.equal(requests.at(-1).action, 'set_value');
assert.equal(requests.at(-1).text, '', 'native value setting must preserve an intentional empty value');

const unavailable = createWindowsUiaAdapter({ platform: 'linux' });
assert.equal(unavailable.supported(), false);
assert.deepEqual(await unavailable.warmup(), { supported: false, available: false, ocrAvailable: false });
assert.deepEqual(await unavailable.observe('Notes'), {
  supported: false,
  available: false,
  reason: 'Windows UI Automation is available only on Windows.'
});

const missing = createWindowsUiaAdapter({
  platform: 'win32',
  request: async payload => payload.action === 'warmup'
    ? { supported: true, available: true, ocrAvailable: false }
    : { supported: true, available: false, reason: 'missing' }
});
assert.equal((await missing.observe('Notes')).available, false);
assert.equal((await missing.observe('Notes')).reason, 'missing');

await assert.rejects(() => adapter.observe('Notes', 50, 'invalid'), /auto, semantic, or hybrid/i);

console.log('Windows UI Automation adapter warms once, normalizes hybrid targets, and exposes native semantic actions.');
