import * as fs from 'node:fs';
import * as path from 'node:path';

import { getStateDir } from './statePaths.js';
import { setStateMeta, stateMetaValue, withStateDatabase } from './stateDatabase.js';
import { normalizeTaskProgress, sanitizeTaskRecord } from './taskObservability.js';
import { isTerminalTaskStatus } from './taskState.js';

const MAX_SESSIONS = 500;
const TASK_HISTORY_VERSION = 3;
const HISTORY_FORMAT_MARKER = '.task-history-v3';
const LEGACY_MIGRATION_KEY = 'task_history_legacy_migrated_v1';

function getTaskHistoryDir(config = {}) {
  return path.join(getStateDir(config), 'sessions');
}

function configForDirectory(directory) {
  return { stateDir: path.dirname(path.resolve(directory)) };
}

function ensureCurrentHistory(config = {}) {
  migrateLegacyTaskHistory(config);
}

function listSessions(directory, limit = MAX_SESSIONS) {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  return withStateDatabase(config, db => {
    const rows = db.prepare('SELECT id,payload FROM task_history ORDER BY updated_at_ms DESC,id ASC LIMIT ?')
      .all(Math.max(0, Math.floor(Number(limit) || 0)));
    const sessions = [];
    const invalid = [];
    for (const row of rows) {
      const session = parseStoredSession(row.payload);
      if (session) sessions.push(session);
      else invalid.push(String(row.id));
    }
    if (invalid.length) {
      const remove = db.prepare('DELETE FROM task_history WHERE id=?');
      for (const id of invalid) remove.run(id);
    }
    return sessions;
  }, { transaction: true });
}

function readSession(directory, id) {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  return withStateDatabase(config, db => {
    const row = db.prepare('SELECT payload FROM task_history WHERE id=?').get(String(id || ''));
    if (!row) return null;
    const session = parseStoredSession(row.payload);
    if (session) return session;
    db.prepare('DELETE FROM task_history WHERE id=?').run(String(id || ''));
    return null;
  }, { transaction: true });
}

function removeSession(directory, id) {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  withStateDatabase(config, db => {
    db.prepare('DELETE FROM task_history WHERE id=?').run(String(id || ''));
  }, { transaction: true });
}

function normalizeStoredSession(session, { forWrite = false } = {}) {
  if (!session || typeof session !== 'object') return null;
  const id = String(session.id || '').trim();
  if (!id) return null;
  if (!forWrite) {
    if (Number(session.version || 0) !== TASK_HISTORY_VERSION) return null;
    if (String(session.taskId || '') !== id || String(session.sessionId || '') !== id) return null;
  }
  const current = forWrite
    ? { ...session, id, taskId: id, sessionId: id, version: TASK_HISTORY_VERSION }
    : session;
  const sanitized = sanitizeTaskRecord(current);
  if (!sanitized) return null;
  const resultSummary = sanitized.resultSummary
    || (sanitized.status === 'completed' ? sanitized.summary || '' : '');
  return {
    ...sanitized,
    ...(resultSummary ? { resultSummary } : {}),
    progress: normalizeTaskProgress(sanitized.progress, sanitized.status)
  };
}

function writeSession(directory, session) {
  if (!session?.id) return;
  const sanitized = normalizeStoredSession(session, { forWrite: true });
  if (!sanitized) throw new Error('Task history writes require a current session record.');
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  withStateDatabase(config, db => upsertSession(db, sanitized), { transaction: true });
}

async function writeSessionAsync(directory, session) {
  writeSession(directory, session);
}

function pruneSessions(directory, limit = MAX_SESSIONS) {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  withStateDatabase(config, db => {
    const max = Math.max(0, Math.floor(Number(limit) || 0));
    const rows = db.prepare('SELECT id,payload FROM task_history ORDER BY updated_at_ms DESC,id ASC').all();
    if (rows.length <= max) return;
    let retained = rows.length;
    const remove = db.prepare('DELETE FROM task_history WHERE id=?');
    for (let index = rows.length - 1; index >= 0 && retained > max; index -= 1) {
      const row = rows[index];
      const session = parseStoredSession(row.payload);
      if (!session || isTerminalTaskStatus(session.status)) {
        remove.run(String(row.id));
        retained -= 1;
      }
    }
  }, { transaction: true });
}

function clearTaskHistory(config = {}) {
  migrateLegacyTaskHistory(config);
  withStateDatabase(config, db => db.exec('DELETE FROM task_history'), { transaction: true });
  removeLegacyHistoryFiles(config);
}

function parseStoredSession(payload) {
  try {
    return normalizeStoredSession(JSON.parse(String(payload || '')));
  } catch {
    return null;
  }
}

function upsertSession(db, session, updatedAtMs = Date.now()) {
  const previous = db.prepare('SELECT updated_at_ms FROM task_history WHERE id=?').get(session.id);
  const stamp = Math.max(Math.floor(Number(updatedAtMs) || Date.now()), Number(previous?.updated_at_ms || 0) + 1);
  db.prepare(`INSERT INTO task_history(id,updated_at_ms,payload) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET updated_at_ms=excluded.updated_at_ms,payload=excluded.payload`)
    .run(session.id, stamp, JSON.stringify(session));
}

function migrateLegacyTaskHistory(config = {}) {
  let migrated = false;
  withStateDatabase(config, db => {
    if (stateMetaValue(db, LEGACY_MIGRATION_KEY, '') === '1') return;
    const directory = getTaskHistoryDir(config);
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(directory, entry.name);
      try {
        const source = fs.readFileSync(file, 'utf8');
        const session = normalizeStoredSession(JSON.parse(source));
        if (!session) continue;
        let mtimeMs = Date.now();
        try { mtimeMs = fs.statSync(file).mtimeMs; } catch {}
        upsertSession(db, session, mtimeMs);
      } catch {}
    }
    setStateMeta(db, LEGACY_MIGRATION_KEY, '1');
    migrated = true;
  }, { transaction: true });
  if (migrated) removeLegacyHistoryFiles(config);
}

function removeLegacyHistoryFiles(config = {}) {
  const directory = getTaskHistoryDir(config);
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('-policy.json')) continue;
      try { fs.rmSync(path.join(directory, entry.name), { force: true }); } catch {}
    }
    try { fs.rmdirSync(directory); } catch (error) {
      if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') throw error;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }
  try { fs.rmSync(path.join(getStateDir(config), HISTORY_FORMAT_MARKER), { force: true }); } catch {}
}

function resetTaskHistoryCaches() {}

export {
  MAX_SESSIONS,
  clearTaskHistory,
  ensureCurrentHistory,
  getTaskHistoryDir,
  listSessions,
  pruneSessions,
  readSession,
  removeSession,
  resetTaskHistoryCaches,
  writeSession,
  writeSessionAsync
};
