import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listSessions, readSession, resetTaskHistoryCaches, writeSession } from '../src/taskHistoryStorage.js';
import { stateDatabasePath, withStateDatabase } from '../src/stateDatabase.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-history-storage-'));
const directory = path.join(stateDir, 'sessions');
const config = { stateDir };

try {
  const id = 'shared-task';
  writeSession(directory, { id, workspace: 'repo', summary: 'before' });
  assert.equal(listSessions(directory, 10)[0]?.summary, 'before');
  assert.equal(fs.existsSync(stateDatabasePath(config)), true, 'task history must use the shared SQLite state database');
  assert.equal(fs.existsSync(path.join(directory, `${id}.json`)), false, 'task history must not create canonical JSON session files');

  withStateDatabase(config, db => {
    const row = db.prepare('SELECT payload FROM task_history WHERE id=?').get(id);
    const session = JSON.parse(row.payload);
    session.summary = 'after!';
    db.prepare('UPDATE task_history SET updated_at_ms=?,payload=? WHERE id=?').run(Date.now() + 1, JSON.stringify(session), id);
  }, { transaction: true });
  assert.equal(listSessions(directory, 10)[0]?.summary, 'after!', 'SQLite readers must observe another process durable update immediately');
  assert.equal(readSession(directory, id)?.summary, 'after!');

  const completedId = 'completed-task';
  writeSession(directory, {
    id: completedId,
    status: 'completed',
    summary: 'Completed work.',
    progress: { mode: 'indeterminate', label: 'Waiting for the next task step' }
  });
  const completed = readSession(directory, completedId);
  assert.equal(completed?.progress?.mode, 'complete');
  assert.equal(completed?.progress?.percentage, 100);
  assert.equal(completed?.resultSummary, 'Completed work.');

  const legacyStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-history-legacy-'));
  try {
    const legacyDirectory = path.join(legacyStateDir, 'sessions');
    fs.mkdirSync(legacyDirectory, { recursive: true });
    fs.writeFileSync(path.join(legacyDirectory, 'legacy.json'), JSON.stringify({
      version: 3,
      id: 'legacy-task',
      taskId: 'legacy-task',
      sessionId: 'legacy-task',
      workspace: 'repo',
      status: 'completed',
      title: 'Legacy task',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:01:00.000Z',
      summary: 'legacy history'
    }));
    const policyFile = path.join(legacyDirectory, 'repo--task-policy-policy.json');
    fs.writeFileSync(policyFile, JSON.stringify({ workspace: 'repo', taskId: 'task-policy' }));
    assert.equal(listSessions(legacyDirectory, 10)[0]?.summary, 'legacy history');
    assert.equal(fs.existsSync(path.join(legacyDirectory, 'legacy.json')), false, 'legacy task-history JSON must be removed after migration');
    assert.equal(fs.existsSync(policyFile), true, 'task-history migration must leave legacy policy JSON for the policy migrator');
  } finally {
    fs.rmSync(legacyStateDir, { recursive: true, force: true });
  }

  console.log('Task-history SQLite persistence, migration, and completed-state normalization passed.');
} finally {
  resetTaskHistoryCaches();
  fs.rmSync(stateDir, { recursive: true, force: true });
}
