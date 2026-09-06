import assert from 'node:assert/strict';
import { applyLiveEvent, getSnapshot, init, patchLocalConnection, subscribe } from '../src/ui/store.js';

init({
  ok: true,
  desktopStatus: { state: 'starting' },
  connectionState: { overall: 'connecting' },
  live: { streamId: 'stream-a', revisions: { task: 2, connection: 1 } },
  taskActivity: { tasks: [], activeTaskCount: 0, activeCalls: 0 },
  config: { workspaces: [{ alias: 'alpha', operational: { state: 'idle' } }] },
  workspaceStates: { alpha: { state: 'idle' } }
});

let notifications = 0;
const unsubscribe = subscribe(() => { notifications += 1; });
const initialSnapshot = getSnapshot();

const stale = applyLiveEvent('task.updated', {
  streamId: 'stream-a',
  revision: 2,
  taskUpdates: [{ id: 'stale', status: 'running' }]
});
assert.equal(stale.accepted, false);
assert.equal(getSnapshot(), initialSnapshot, 'rejected events must retain snapshot identity');
assert.equal(notifications, 0, 'rejected events must not notify React subscribers');

const foreign = applyLiveEvent('task.updated', {
  streamId: 'stream-b',
  revision: 3,
  taskUpdates: [{ id: 'foreign', status: 'running' }]
});
assert.equal(foreign.accepted, false);
assert.equal(getSnapshot(), initialSnapshot, 'foreign streams must retain snapshot identity');
assert.equal(notifications, 0);

const accepted = applyLiveEvent('task.updated', {
  streamId: 'stream-a',
  revision: 3,
  taskUpdates: [{ id: 'task-1', workspace: 'alpha', status: 'running', activeCalls: 1, updatedAt: '2026-09-06T00:00:00Z' }]
});
assert.equal(accepted.accepted, true);
assert.notEqual(getSnapshot(), initialSnapshot, 'accepted events must publish a new snapshot identity');
assert.equal(notifications, 1);
assert.equal(getSnapshot().live.revisions.task, 3);
assert.equal(initialSnapshot.live.revisions.task, 2, 'previous snapshot metadata must remain unchanged');
assert.equal(initialSnapshot.taskActivity.tasks.length, 0, 'previous nested task state must not be mutated');

const acceptedSnapshot = getSnapshot();
patchLocalConnection({ desktopStatus: acceptedSnapshot.desktopStatus });
assert.equal(getSnapshot(), acceptedSnapshot, 'a local no-op must retain snapshot identity');
assert.equal(notifications, 1, 'a local no-op must not notify subscribers');

patchLocalConnection({ connectionState: { overall: 'available' } });
assert.notEqual(getSnapshot(), acceptedSnapshot);
assert.equal(notifications, 2, 'accepted local mutations must notify subscribers');

unsubscribe();
patchLocalConnection({ connectionState: { overall: 'live' } });
assert.equal(notifications, 2, 'unsubscribe must stop notifications');

console.log('Dashboard React store subscription contracts passed.');
