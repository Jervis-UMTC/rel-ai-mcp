import assert from 'node:assert/strict';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { withAbortResource } from '../src/abortablePromise.ts';

const controller = new AbortController();
let resolveSource;
let cleanupCalled = false;
const source = new Promise(resolve => {
  resolveSource = resolve;
});
const unhandled = [];
const onUnhandledRejection = reason => unhandled.push(reason);
process.on('unhandledRejection', onUnhandledRejection);

try {
  const result = withAbortResource(
    source,
    controller.signal,
    () => {
      cleanupCalled = true;
      throw new Error('sync cleanup failure');
    },
    () => new Error('operation aborted')
  );

  controller.abort();
  await assert.rejects(result, /operation aborted/);
  resolveSource('resource');
  await waitForImmediate();

  assert.equal(cleanupCalled, true, 'a resource resolved after cancellation must still be cleaned up');
  assert.deepEqual(unhandled, [], 'synchronous cleanup failures after cancellation must not escape as unhandled rejections');
} finally {
  process.off('unhandledRejection', onUnhandledRejection);
}

console.log('Abortable resource cleanup regression test passed.');
