import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { statePath } from './stateLayout.js';

const STATE_SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS state_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS task_history(
  id TEXT PRIMARY KEY,
  updated_at_ms INTEGER NOT NULL,
  payload TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS task_history_updated_idx
  ON task_history(updated_at_ms DESC);
CREATE TABLE IF NOT EXISTS session_policies(
  workspace TEXT NOT NULL,
  task_id TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(workspace, task_id)
) STRICT;
CREATE INDEX IF NOT EXISTS session_policies_workspace_idx
  ON session_policies(workspace, updated_at_ms DESC);
CREATE TABLE IF NOT EXISTS native_tasks(
  task_id TEXT PRIMARY KEY,
  updated_at_ms INTEGER NOT NULL,
  payload TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS native_tasks_updated_idx
  ON native_tasks(updated_at_ms DESC);
CREATE TABLE IF NOT EXISTS native_task_quarantine(
  id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL,
  quarantined_at_ms INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS native_task_quarantine_age_idx
  ON native_task_quarantine(quarantined_at_ms);
CREATE TABLE IF NOT EXISTS analytics_months(
  month TEXT PRIMARY KEY,
  updated_at_ms INTEGER NOT NULL,
  payload TEXT NOT NULL
) STRICT;
`;

function stateDatabasePath(config = {}) {
  return statePath(config, 'durable-state.sqlite');
}

function openStateDatabase(config = {}, options = {}) {
  const readonly = options.readonly === true;
  const file = stateDatabasePath(config);
  if (!readonly) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (readonly && !fs.existsSync(file)) return null;
  const timeout = Math.max(0, Math.floor(Number(options.timeoutMs ?? 5000)));
  const db = new DatabaseSync(file, { readOnly: readonly, timeout });
  try {
    db.enableLoadExtension(false);
    db.exec('PRAGMA foreign_keys=ON');
    if (!readonly) {
      db.exec('PRAGMA journal_mode=WAL');
      db.exec('PRAGMA synchronous=NORMAL');
      ensureStateSchema(db);
      try { fs.chmodSync(file, 0o600); } catch {}
    }
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

function withStateDatabase(config, operation, options = {}) {
  const db = openStateDatabase(config, options);
  if (!db) return options.missingValue;
  const transaction = options.transaction === true;
  try {
    if (transaction) db.exec('BEGIN IMMEDIATE');
    const result = operation(db);
    if (transaction) db.exec('COMMIT');
    return result;
  } catch (error) {
    if (transaction) {
      try { db.exec('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    try { db.close(); } catch {}
  }
}

function ensureStateSchema(db) {
  db.exec(SCHEMA_SQL);
  const current = Number(stateMetaValue(db, 'schema_version', 0));
  if (current > STATE_SCHEMA_VERSION) {
    throw new Error(`Durable state schema ${current} is newer than supported schema ${STATE_SCHEMA_VERSION}.`);
  }
  setStateMeta(db, 'schema_version', STATE_SCHEMA_VERSION);
}

function stateMetaValue(db, key, fallback = '') {
  try {
    return db.prepare('SELECT value FROM state_meta WHERE key=?').get(String(key))?.value ?? fallback;
  } catch {
    return fallback;
  }
}

function setStateMeta(db, key, value) {
  db.prepare(`INSERT INTO state_meta(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(key), String(value));
}

function isSqliteBusyError(error) {
  const code = String(error?.code || error?.errcode || '');
  const message = String(error?.message || '');
  return code === 'SQLITE_BUSY'
    || code === 'SQLITE_LOCKED'
    || /database is (?:busy|locked)/i.test(message)
    || /SQLITE_(?:BUSY|LOCKED)/i.test(message);
}

export {
  STATE_SCHEMA_VERSION,
  isSqliteBusyError,
  openStateDatabase,
  setStateMeta,
  stateDatabasePath,
  stateMetaValue,
  withStateDatabase
};
