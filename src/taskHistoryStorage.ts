import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { TaskDto } from './contracts/tasks.ts';
import { getStateDir } from './statePaths.js';
import { setStateMeta, stateMetaValue, withStateDatabase } from './stateDatabase.ts';
import { normalizeTaskProgress, sanitizeTaskRecord } from './taskObservability.js';
import { isTerminalTaskStatus } from './taskState.js';

const MAX_SESSIONS = 500;
const TASK_HISTORY_VERSION = 3;
const HISTORY_FORMAT_MARKER = '.task-history-v3';
const LEGACY_MIGRATION_KEY = 'task_history_legacy_migrated_v1';
const migratedStateDirs = new Set<string>();

type TaskHistoryConfig = Record<string, unknown> & { stateDir?: string };
type StoredTaskSession = TaskDto & Record<string, any>;

interface TaskHistoryRow {
  id: string;
  payload: string;
  updated_at_ms?: number;
}

interface TaskHistoryEventRow {
  id: string;
  workspace?: string;
  task_id?: string;
  session_id?: string;
  payload: string;
}

interface SessionTextSearchOptions {
  limit?: number;
  workspace?: string;
  excludeWorkspace?: string;
}

function getTaskHistoryDir(config: TaskHistoryConfig = {}): string {
  return path.join(getStateDir(config), 'sessions');
}

function configForDirectory(directory: string): TaskHistoryConfig {
  return { stateDir: path.dirname(path.resolve(directory)) };
}

function ensureCurrentHistory(config: TaskHistoryConfig = {}): void {
  migrateLegacyTaskHistory(config);
}

function listSessions(directory: string, limit = MAX_SESSIONS): StoredTaskSession[] {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  return withStateDatabase(config, (db: DatabaseSync) => {
    const rows = db.prepare('SELECT id,payload FROM task_history ORDER BY updated_at_ms DESC,id ASC LIMIT ?')
      .all(Math.max(0, Math.floor(Number(limit) || 0))) as unknown as TaskHistoryRow[];
    return parseSessionRows(db, rows);
  }, { transaction: true }) as StoredTaskSession[];
}

function listSessionSummaries(directory: string, limit = MAX_SESSIONS): StoredTaskSession[] {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  return withStateDatabase(config, (db: DatabaseSync) => {
    const rows = db.prepare(`
      SELECT id,
        CASE
          WHEN json_valid(payload) THEN json_set(
            json_remove(payload, '$.events', '$.workflowEvidence'),
            '$.events',
            CASE
              WHEN json_type(payload, '$.events') = 'array'
                AND json_array_length(json_extract(payload, '$.events')) = 1
                AND json_type(payload, '$.events[0]') = 'object'
                THEN json_array(json(json_extract(payload, '$.events[0]')))
              ELSE json('[]')
            END
          )
          ELSE payload
        END AS payload
      FROM task_history
      ORDER BY updated_at_ms DESC,id ASC
      LIMIT ?
    `).all(Math.max(0, Math.floor(Number(limit) || 0))) as unknown as TaskHistoryRow[];
    return parseSessionRows(db, rows);
  }, { transaction: true }) as StoredTaskSession[];
}

function findSessionsContaining(directory: string, values: unknown, options: SessionTextSearchOptions = {}): StoredTaskSession[] {
  const needles = [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').replace(/\p{Cc}+/gu, ' ').trim().toLowerCase())
    .filter(value => value.length >= 4)
    .map(value => value.slice(0, 500)))]
    .slice(0, 12);
  if (!needles.length) return [];
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  return withStateDatabase(config, (db: DatabaseSync) => {
    const filters = [`(${needles.map(() => 'instr(lower(payload), ?) > 0').join(' OR ')})`];
    const parameters: Array<string | number> = [...needles];
    const workspace = String(options.workspace || '').trim();
    const excludeWorkspace = String(options.excludeWorkspace || '').trim();
    if (workspace) {
      filters.push("COALESCE(json_extract(payload, '$.workspace'), '') = ?");
      parameters.push(workspace);
    } else if (excludeWorkspace) {
      filters.push("COALESCE(json_extract(payload, '$.workspace'), '') <> ?");
      parameters.push(excludeWorkspace);
    }
    const limit = Math.min(MAX_SESSIONS, Math.max(1, Math.floor(Number(options.limit) || 40)));
    parameters.push(limit);
    const rows = db.prepare(`SELECT id,payload FROM task_history
      WHERE ${filters.join(' AND ')}
      ORDER BY updated_at_ms DESC,id ASC
      LIMIT ?`).all(...parameters) as unknown as TaskHistoryRow[];
    return parseSessionRows(db, rows);
  }, { transaction: true }) as StoredTaskSession[];
}

function listRecentSessionEvents(directory: string, limit = MAX_SESSIONS): Record<string, any>[] {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  return withStateDatabase(config, (db: DatabaseSync) => {
    const rows = db.prepare(`
      SELECT
        task.id,
        CASE WHEN json_valid(task.payload) THEN json_extract(task.payload, '$.workspace') END AS workspace,
        CASE WHEN json_valid(task.payload) THEN json_extract(task.payload, '$.taskId') END AS task_id,
        CASE WHEN json_valid(task.payload) THEN json_extract(task.payload, '$.sessionId') END AS session_id,
        event.value AS payload
      FROM task_history AS task
      CROSS JOIN json_each(
        CASE WHEN json_valid(task.payload) THEN task.payload ELSE '{"events":[]}' END,
        '$.events'
      ) AS event
      WHERE event.type = 'object'
      ORDER BY
        COALESCE(
          json_extract(event.value, '$.timestamp'),
          json_extract(event.value, '$.ts'),
          json_extract(event.value, '$.at'),
          json_extract(event.value, '$.createdAt'),
          json_extract(event.value, '$.startedAt'),
          ''
        ) DESC,
        task.updated_at_ms DESC,
        task.id ASC,
        CAST(event.key AS INTEGER) DESC
      LIMIT ?
    `).all(Math.max(0, Math.floor(Number(limit) || 0))) as unknown as TaskHistoryEventRow[];
    return rows.flatMap(row => {
      try {
        const event = JSON.parse(String(row.payload || '')) as Record<string, any>;
        if (!event || typeof event !== 'object' || Array.isArray(event)) return [];
        return [{
          ...event,
          workspace: event.workspace || row.workspace || '',
          taskId: event.taskId || row.task_id || row.id,
          sessionId: event.sessionId || row.session_id || row.id
        }];
      } catch {
        return [];
      }
    });
  }, { transaction: false }) as Record<string, any>[];
}

function parseSessionRows(db: DatabaseSync, rows: TaskHistoryRow[]): StoredTaskSession[] {
  const sessions: StoredTaskSession[] = [];
  const invalid: string[] = [];
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
}

function readSession(directory: string, id: unknown): StoredTaskSession | null {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  return withStateDatabase(config, (db: DatabaseSync) => {
    const row = db.prepare('SELECT payload FROM task_history WHERE id=?').get(String(id || '')) as Pick<TaskHistoryRow, 'payload'> | undefined;
    if (!row) return null;
    const session = parseStoredSession(row.payload);
    if (session) return session;
    db.prepare('DELETE FROM task_history WHERE id=?').run(String(id || ''));
    return null;
  }, { transaction: true }) as StoredTaskSession | null;
}

function removeSession(directory: string, id: unknown): void {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  withStateDatabase(config, (db: DatabaseSync) => {
    db.prepare('DELETE FROM task_history WHERE id=?').run(String(id || ''));
  }, { transaction: true });
}

function removeWorkspaceSessions(config: TaskHistoryConfig = {}, workspaceValue: unknown): string[] {
  const workspace = String(workspaceValue || '').trim();
  if (!workspace) return [];
  migrateLegacyTaskHistory(config);
  return withStateDatabase(config, (db: DatabaseSync) => {
    const rows = db.prepare('SELECT id,payload FROM task_history').all() as unknown as TaskHistoryRow[];
    const removed: string[] = [];
    const remove = db.prepare('DELETE FROM task_history WHERE id=?');
    for (const row of rows) {
      const session = parseStoredSession(row.payload);
      if (!session || String(session.workspace || '').trim() !== workspace) continue;
      remove.run(String(row.id));
      removed.push(String(row.id));
    }
    return removed;
  }, { transaction: true }) as string[];
}

function normalizeStoredSession(session: unknown, { forWrite = false }: { forWrite?: boolean } = {}): StoredTaskSession | null {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return null;
  const input = session as Record<string, any>;
  const id = String(input.id || '').trim();
  if (!id) return null;
  if (!forWrite) {
    if (Number(input.version || 0) !== TASK_HISTORY_VERSION) return null;
    if (String(input.taskId || '') !== id || String(input.sessionId || '') !== id) return null;
  }
  const current = forWrite
    ? { ...input, id, taskId: id, sessionId: id, version: TASK_HISTORY_VERSION }
    : input;
  const sanitized = sanitizeTaskRecord(current) as StoredTaskSession | null;
  if (!sanitized) return null;
  const resultSummary = sanitized.resultSummary
    || (sanitized.status === 'completed' ? sanitized.summary || '' : '');
  return {
    ...sanitized,
    ...(resultSummary ? { resultSummary } : {}),
    progress: normalizeTaskProgress(sanitized.progress, sanitized.status)
  } as StoredTaskSession;
}

function writeSession(directory: string, session: StoredTaskSession | Record<string, any>): void {
  if (!session?.id) return;
  const sanitized = normalizeStoredSession(session, { forWrite: true });
  if (!sanitized) throw new Error('Task history writes require a current session record.');
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  withStateDatabase(config, (db: DatabaseSync) => upsertSession(db, sanitized), { transaction: true });
}

async function writeSessionAsync(directory: string, session: StoredTaskSession | Record<string, any>): Promise<void> {
  writeSession(directory, session);
}

function pruneSessions(directory: string, limit = MAX_SESSIONS): void {
  const config = configForDirectory(directory);
  migrateLegacyTaskHistory(config);
  withStateDatabase(config, (db: DatabaseSync) => {
    const max = Math.max(0, Math.floor(Number(limit) || 0));
    const rows = db.prepare('SELECT id,payload FROM task_history ORDER BY updated_at_ms DESC,id ASC').all() as unknown as TaskHistoryRow[];
    if (rows.length <= max) return;
    let retained = rows.length;
    const remove = db.prepare('DELETE FROM task_history WHERE id=?');
    for (let index = rows.length - 1; index >= 0 && retained > max; index -= 1) {
      const row = rows[index];
      if (!row) continue;
      const session = parseStoredSession(row.payload);
      if (!session || isTerminalTaskStatus(session.status)) {
        remove.run(String(row.id));
        retained -= 1;
      }
    }
  }, { transaction: true });
}

function clearTaskHistory(config: TaskHistoryConfig = {}): void {
  migrateLegacyTaskHistory(config);
  withStateDatabase(config, (db: DatabaseSync) => db.exec('DELETE FROM task_history'), { transaction: true });
  removeLegacyHistoryFiles(config);
}

function parseStoredSession(payload: unknown): StoredTaskSession | null {
  try {
    return normalizeStoredSession(JSON.parse(String(payload || '')) as unknown);
  } catch {
    return null;
  }
}

function upsertSession(db: DatabaseSync, session: StoredTaskSession, updatedAtMs: unknown = Date.now()): void {
  const previous = db.prepare('SELECT updated_at_ms FROM task_history WHERE id=?').get(session.id) as { updated_at_ms?: unknown } | undefined;
  const stamp = Math.max(Math.floor(Number(updatedAtMs) || Date.now()), Number(previous?.updated_at_ms || 0) + 1);
  db.prepare(`INSERT INTO task_history(id,updated_at_ms,payload) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET updated_at_ms=excluded.updated_at_ms,payload=excluded.payload`)
    .run(session.id, stamp, JSON.stringify(session));
}

function migrateLegacyTaskHistory(config: TaskHistoryConfig = {}): void {
  let stateKey = '';
  try {
    stateKey = path.resolve(getStateDir(config));
  } catch {
    stateKey = '';
  }
  if (stateKey && migratedStateDirs.has(stateKey)) return;
  let migrated = false;
  withStateDatabase(config, (db: DatabaseSync) => {
    if (stateMetaValue(db, LEGACY_MIGRATION_KEY, '') === '1') return;
    const directory = getTaskHistoryDir(config);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(directory, entry.name);
      try {
        const source = fs.readFileSync(file, 'utf8');
        const session = normalizeStoredSession(JSON.parse(source) as unknown);
        if (!session) continue;
        let mtimeMs = Date.now();
        try { mtimeMs = fs.statSync(file).mtimeMs; } catch {}
        upsertSession(db, session, mtimeMs);
      } catch {}
    }
    setStateMeta(db, LEGACY_MIGRATION_KEY, '1');
    migrated = true;
  }, { transaction: true });
  if (stateKey) migratedStateDirs.add(stateKey);
  if (migrated) removeLegacyHistoryFiles(config);
}

function removeLegacyHistoryFiles(config: TaskHistoryConfig = {}): void {
  const directory = getTaskHistoryDir(config);
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('-policy.json')) continue;
      try { fs.rmSync(path.join(directory, entry.name), { force: true }); } catch {}
    }
    try { fs.rmdirSync(directory); } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOTEMPTY' && code !== 'ENOENT') throw error;
    }
  } catch (error) {
    const code = errorCode(error);
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
  }
  try { fs.rmSync(path.join(getStateDir(config), HISTORY_FORMAT_MARKER), { force: true }); } catch {}
}

function resetTaskHistoryCaches(): void {
  migratedStateDirs.clear();
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code || '') : '';
}

export {
  MAX_SESSIONS,
  clearTaskHistory,
  ensureCurrentHistory,
  findSessionsContaining,
  getTaskHistoryDir,
  listRecentSessionEvents,
  listSessionSummaries,
  listSessions,
  pruneSessions,
  readSession,
  removeSession,
  removeWorkspaceSessions,
  resetTaskHistoryCaches,
  writeSession,
  writeSessionAsync
};

export type { StoredTaskSession, TaskHistoryConfig };
