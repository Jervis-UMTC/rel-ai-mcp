import assert from 'node:assert/strict';

import { createWindowsUiaAdapter } from '../src/computer/windowsUiaAdapter.js';

let requests = [];
const adapter = createWindowsUiaAdapter({
  platform: 'win32',
  request: async payload => {
    requests.push(payload);
    return {
      supported: true,
      available: true,
      window: {
        title: 'Notes',
        processName: 'notes',
        processId: 123,
        className: 'NotesWindow',
        displayId: '\\\\.\\DISPLAY1'
      },
      elements: [
        {
          targetId: 'e1', role: 'Button', name: 'Save', automationId: 'save', className: 'Button', enabled: true,
          displayId: '\\\\.\\DISPLAY1', x: 100, y: 200, width: 80, height: 30, centerX: 140, centerY: 215
        },
        { targetId: '', role: 'Button', displayId: '', width: 0, height: 0 }
      ],
      count: 2,
      truncated: false
    };
  }
});

assert.equal(adapter.supported(), true);
const observation = await adapter.observe('Notes', 50);
assert.deepEqual(requests, [{ action: 'observe', app: 'Notes', maxElements: 50 }]);
assert.equal(observation.available, true);
assert.equal(observation.count, 1, 'malformed UIA targets must be filtered at the adapter boundary');
assert.equal(observation.elements[0].targetId, 'e1');
assert.equal(observation.elements[0].centerX, 140);
assert.equal(observation.window.processName, 'notes');

const unavailable = createWindowsUiaAdapter({ platform: 'linux' });
assert.equal(unavailable.supported(), false);
assert.deepEqual(await unavailable.observe('Notes'), {
  supported: false,
  available: false,
  reason: 'Windows UI Automation is available only on Windows.'
});

const missing = createWindowsUiaAdapter({
  platform: 'win32',
  request: async () => ({ supported: true, available: false, reason: 'missing' })
});
assert.equal((await missing.observe('Notes')).available, false);
assert.equal((await missing.observe('Notes')).reason, 'missing');

console.log('Windows UI Automation adapter bounds semantic observations and degrades cleanly off Windows.');
