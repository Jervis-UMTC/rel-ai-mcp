import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearSessionPolicy,
  ensureSessionStarted,
  readSessionPolicy,
  touchSessionPolicy,
  writeSessionPolicy,
  SESSION_TOUCH_PERSIST_INTERVAL_MS
} from '../src/policyResolver.js';
import { withStateDatabase } from '../src/stateDatabase.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-policy-store-'));
const config = { stateDir: path.join(root, 'state') };
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(workspaceRoot, { recursive: true });

try {
  const alias = 'app';
  const taskId = 'task-1';
  await writeSessionPolicy(config, alias, { workspaceRoot, taskId, taskHint: 'store test' });
  const before = withStateDatabase(config, db => db.prepare('SELECT updated_at_ms,payload FROM session_policies WHERE workspace=? AND task_id=?').get(alias, taskId));

  assert.equal(touchSessionPolicy(config, alias, taskId), true);
  const afterHotTouch = withStateDatabase(config, db => db.prepare('SELECT updated_at_ms,payload FROM session_policies WHERE workspace=? AND task_id=?').get(alias, taskId));
  assert.deepEqual(afterHotTouch, before, 'hot-path touches must not rewrite SQLite inside the persistence interval');
  assert.equal(readSessionPolicy(config, alias, taskId)?.taskHint, 'store test');
  assert.equal(await ensureSessionStarted(config, alias, workspaceRoot, { taskId, taskHint: 'ignored' }), false);

  const externallyEdited = JSON.parse(before.payload);
  externallyEdited.taskHint = 'external edit';
  withStateDatabase(config, db => db.prepare('UPDATE session_policies SET updated_at_ms=?,payload=? WHERE workspace=? AND task_id=?')
    .run(Date.now() + 1, JSON.stringify(externallyEdited), alias, taskId), { transaction: true });
  assert.equal(readSessionPolicy(config, alias, taskId)?.taskHint, 'external edit', 'SQLite reads must observe external durable updates immediately');

  assert.equal(clearSessionPolicy(config, alias, taskId).cleared, true);
  assert.equal(readSessionPolicy(config, alias, taskId), null);

  const oldTaskId = 'task-old';
  const oldUpdatedAtMs = Date.now() - SESSION_TOUCH_PERSIST_INTERVAL_MS - 5_000;
  const oldUpdatedAt = new Date(oldUpdatedAtMs).toISOString();
  const oldPolicy = { workspace: alias, taskId: oldTaskId, createdAt: oldUpdatedAt, updatedAt: oldUpdatedAt, baselineCaptured: true, baselineDirty: [] };
  withStateDatabase(config, db => db.prepare('INSERT INTO session_policies(workspace,task_id,updated_at_ms,payload) VALUES(?,?,?,?)')
    .run(alias, oldTaskId, oldUpdatedAtMs, JSON.stringify(oldPolicy)), { transaction: true });
  assert.equal(touchSessionPolicy(config, alias, oldTaskId), true);
  const persistedOldTouch = readSessionPolicy(config, alias, oldTaskId);
  assert.ok(Date.parse(persistedOldTouch.updatedAt) > oldUpdatedAtMs);
  clearSessionPolicy(config, alias, oldTaskId);

  console.log('Session policy SQLite visibility and persistence-throttle tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
