import assert from 'node:assert/strict';
import {
  TASK_RUNTIME_EVENT_PHASES,
  TASK_RUNTIME_TERMINAL_PHASES,
  eventIdentityKey,
  eventTimestampMs,
  eventTimestampValue,
  isoTimestamp,
  terminalTaskTimestamp,
  terminalTaskTimestampValue,
  timestampMs
} from '../src/taskEvents.js';

assert.deepEqual(TASK_RUNTIME_EVENT_PHASES, [
  'started', 'progress', 'completion_requested', 'finished', 'cancelled', 'inactive', 'completed'
]);
assert.deepEqual([...TASK_RUNTIME_TERMINAL_PHASES], ['completed', 'cancelled', 'inactive']);

assert.equal(timestampMs('2026-08-05T10:00:00.000Z'), Date.parse('2026-08-05T10:00:00.000Z'));
assert.equal(timestampMs('invalid'), 0);
assert.equal(isoTimestamp('2026-08-05T10:00:00.000Z'), '2026-08-05T10:00:00.000Z');
assert.equal(isoTimestamp('invalid'), '');
const event = {
  eventId: 'event-1',
  operationId: 'operation-1',
  timestamp: '2026-08-05T10:00:00.000Z',
  ts: '2026-08-05T09:00:00.000Z'
};
assert.equal(eventTimestampValue(event), event.timestamp);
assert.equal(eventTimestampMs(event), Date.parse(event.timestamp));
assert.equal(eventIdentityKey(event), 'event-1');
assert.equal(eventIdentityKey({ ...event, eventId: '' }), 'operation-1');
assert.equal(eventIdentityKey({ ts: event.ts, tool: 'relai_read' }, 2), eventIdentityKey({ ts: event.ts, tool: 'relai_read' }, 2));
assert.notEqual(eventIdentityKey({ ts: event.ts, tool: 'relai_read' }, 2), eventIdentityKey({ ts: event.ts, tool: 'relai_read' }, 3));
const task = {
  endedAt: '2026-08-05T12:00:00.000Z',
  completedAt: '2026-08-05T11:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z'
};
assert.equal(terminalTaskTimestampValue(task), task.endedAt);
assert.equal(terminalTaskTimestamp(task), Date.parse(task.endedAt));
console.log('Task event identity and timestamp helpers passed.');
