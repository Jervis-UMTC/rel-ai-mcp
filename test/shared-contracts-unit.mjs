import assert from 'node:assert/strict';

import { computerControlSettingsPatchSchema } from '../src/contracts/computer.ts';
import { CONNECTION_STATE_VALUES } from '../src/contracts/connection.ts';
import { createDashboardSnapshot, DASHBOARD_MODEL_VERSION } from '../src/contracts/dashboard.ts';
import { DESKTOP_IPC_CHANNELS, DESKTOP_IPC_INPUT_CONTRACT } from '../src/contracts/desktop.ts';
import { diagnosticResetRequestSchema } from '../src/contracts/diagnostics.ts';
import { createEmptyDashboardRevisions, DASHBOARD_LIVE_EVENT_TYPES } from '../src/contracts/events.ts';
import { MCP_CONTENT_TYPES } from '../src/contracts/mcp.ts';
import { createManagedProcessList } from '../src/contracts/processes.ts';
import { CANONICAL_TASK_STATUSES, createEmptyTaskActivity } from '../src/contracts/tasks.ts';
import { createWorkspaceUpdatePayload } from '../src/contracts/workspaces.ts';

assert.deepEqual(createEmptyTaskActivity(), {
  state: 'idle',
  activeCalls: 0,
  activeTaskCount: 0,
  tasks: [],
  taskId: '',
  workspace: '',
  tool: '',
  startedAt: null,
  lastTask: null
});
assert.ok(CANONICAL_TASK_STATUSES.includes('waiting_for_approval'));

const snapshot = createDashboardSnapshot({ streamId: 'stream-1', sequence: 2, revision: 'rev-1', generatedAt: '2026-09-06T00:00:00.000Z' });
assert.deepEqual(snapshot, {
  streamId: 'stream-1',
  sequence: 2,
  revision: 'rev-1',
  generatedAt: '2026-09-06T00:00:00.000Z',
  modelVersion: DASHBOARD_MODEL_VERSION
});
assert.deepEqual(createEmptyDashboardRevisions(), { task: 0, connection: 0, workspace: 0, process: 0, diagnostics: 0 });
assert.ok(DASHBOARD_LIVE_EVENT_TYPES.includes('task.updated'));

assert.ok(CONNECTION_STATE_VALUES.dashboardUpdates.includes('reconnecting'));
assert.deepEqual(createWorkspaceUpdatePayload('repo', { exists: true }), { alias: 'repo', state: { exists: true } });
assert.deepEqual(createManagedProcessList([{ processId: 'proc-1' }]), { ok: true, processes: [{ processId: 'proc-1' }], count: 1 });

assert.equal(computerControlSettingsPatchSchema.safeParse({ enabled: true }).success, true);
assert.equal(computerControlSettingsPatchSchema.safeParse({ enabled: 'yes' }).success, false);
assert.equal(diagnosticResetRequestSchema.safeParse({ target: 'history', confirm: true }).success, true);
assert.equal(diagnosticResetRequestSchema.safeParse({ target: 'other', confirm: true }).success, false);
assert.equal(diagnosticResetRequestSchema.safeParse({ target: 'history', confirm: false }).success, false);

assert.equal(new Set(DESKTOP_IPC_CHANNELS).size, DESKTOP_IPC_CHANNELS.length);
for (const channel of Object.keys(DESKTOP_IPC_INPUT_CONTRACT)) assert.ok(DESKTOP_IPC_CHANNELS.includes(channel));
assert.deepEqual(MCP_CONTENT_TYPES, { TEXT: 'text', IMAGE: 'image', RESOURCE_LINK: 'resource_link' });

console.log('Canonical shared contract checks passed.');
