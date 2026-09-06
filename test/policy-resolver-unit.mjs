import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolvePolicy, writeSessionPolicy, clearSessionPolicy, readSessionPolicy } from '../src/policyResolver.js';
import { withStateDatabase } from '../src/stateDatabase.ts';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-policy-'));
const config = { stateDir };
const alias = 'myapp';
const taskId = 'task-policy';

try {
  for (const workspace of [{ alias, path: stateDir }, alias, null, {}]) {
    clearSessionPolicy(config, alias, taskId);
    const policy = resolvePolicy(workspace, config);
    assert.equal(policy.sessionActive, false);
    assert.equal(policy.source, 'default');
    assert.equal(policy.trusted, true);
  }

  await assert.rejects(() => writeSessionPolicy(config, alias, { taskHint: 'missing identity' }), /taskId/);

  await writeSessionPolicy(config, alias, { taskHint: 'fix auth bug', taskId });
  const session = readSessionPolicy(config, alias, taskId);
  assert.equal(session.workspace, alias);
  assert.equal(session.taskId, taskId);
  assert.equal(session.taskHint, 'fix auth bug');
  assert.match(session.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const active = resolvePolicy({ alias, path: stateDir }, config);
  assert.equal(active.trusted, false);
  assert.equal(active.sessionActive, true);
  assert.equal(active.baselineCaptured, false);
  assert.equal(active.taskHint, 'fix auth bug');
  assert.equal(active.source, 'task_session_store');

  clearSessionPolicy(config, alias, taskId);
  await writeSessionPolicy(config, alias, { workspaceRoot: path.join(stateDir, 'missing-workspace'), taskId });
  const failedBaseline = resolvePolicy({ alias }, config);
  assert.equal(failedBaseline.sessionActive, true);
  assert.equal(failedBaseline.baselineCaptured, false);
  assert.equal(failedBaseline.trusted, false);
  assert.ok(failedBaseline.baselineCaptureError);

  assert.equal(clearSessionPolicy(config, alias, taskId).cleared, true);
  assert.equal(resolvePolicy({ alias }, config).sessionActive, false);
  assert.equal(clearSessionPolicy(config, alias, taskId).cleared, false);
  assert.equal(clearSessionPolicy(config, alias).cleared, false);

  for (const payload of ['NOT JSON', '[1,2,3]', '{}', '42', '"sneaky"', 'null']) {
    withStateDatabase(config, db => db.prepare(`INSERT INTO session_policies(workspace,task_id,updated_at_ms,payload) VALUES(?,?,?,?)
      ON CONFLICT(workspace,task_id) DO UPDATE SET updated_at_ms=excluded.updated_at_ms,payload=excluded.payload`).run(alias, taskId, Date.now(), payload), { transaction: true });
    assert.equal(readSessionPolicy(config, alias, taskId), null, `invalid session payload must be rejected: ${payload}`);
    assert.equal(resolvePolicy({ alias }, config).sessionActive, false);
  }
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Policy resolver tests passed with SQLite-backed task-scoped sessions and malformed-state rejection.');
