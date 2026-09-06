import * as fs from 'node:fs';
import * as path from 'node:path';
import { statePath } from './stateLayout.js';
import { setStateMeta, stateMetaValue, withStateDatabase } from './stateDatabase.js';
import { failureCategoryFromCode, normalizeFailureCategory } from './analyticsFailureCategory.js';
import { classifyAnalyticsOutcome, reliabilityCountersForOutcome } from './analyticsOutcome.js';
import { telemetryStatus } from './telemetry.js';

const SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const LOCAL_DEVICE_ID = 'local-device';
const LOCAL_DEVICE_NAME = 'This device';
const LOCAL_ANALYTICS_RETENTION_DAYS = 180;
const RETENTION_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LEGACY_MIGRATION_KEY = 'local_analytics_legacy_migrated_v1';
const retentionPruneTimes = new Map();

function recordLocalToolOutcome(config = {}, event = {}) {
  try {
    const at = boundedDate(event.at);
    const month = monthKey(at);
    const hour = hourKey(at);
    const tool = boundedLabel(event.tool, 160) || 'unknown-tool';
    const workspace = boundedLabel(event.workspace, 160);
    const durationMs = boundedDuration(event.durationMs);
    const success = event.ok === true ? 1 : 0;
    const failure = success ? 0 : 1;
    const category = failure ? failureCategoryFromCode(event.errorCode) : '';
    const outcome = classifyAnalyticsOutcome(event);
    const reliability = reliabilityCountersForOutcome(outcome);
    migrateLegacyLocalAnalytics(config);
    withStateDatabase(config, db => {
      const document = readDocumentFromDatabase(db, month);
      incrementTotals(document.totals, success, failure, durationMs, reliability);
      incrementNamed(document.tools, 'tool', tool, success, failure, durationMs, reliability);
      if (workspace) {
        incrementNamed(document.workspaces, 'workspace', workspace, success, failure, durationMs, reliability);
        incrementWorkspaceTool(document.workspaceTools, workspace, tool, success, failure, durationMs, reliability);
      }
      if (failure) {
        incrementFailureCategory(document.failureCategories, category);
        if (workspace) incrementWorkspaceFailureCategory(document.workspaceFailureCategories, workspace, category);
      }

      const hourly = findOrCreate(document.hours, row => row.hour === hour, () => ({
        hour,
        ...emptyAggregate(true),
        tools: [],
        workspaces: [],
        workspaceTools: [],
        failureCategories: [],
        workspaceFailureCategories: []
      }));
      incrementTotals(hourly, success, failure, durationMs, reliability);
      incrementNamed(hourly.tools, 'tool', tool, success, failure, durationMs, reliability);
      if (workspace) {
        incrementNamed(hourly.workspaces, 'workspace', workspace, success, failure, durationMs, reliability);
        incrementWorkspaceTool(hourly.workspaceTools, workspace, tool, success, failure, durationMs, reliability);
      }
      if (failure) {
        incrementFailureCategory(hourly.failureCategories, category);
        if (workspace) incrementWorkspaceFailureCategory(hourly.workspaceFailureCategories, workspace, category);
      }
      upsertDocument(db, document);
    }, { transaction: true });
    scheduleRetentionPrune(config);
    return true;
  } catch {
    return false;
  }
}

function readLocalUsageSnapshot(config = {}, requestedMonth = '') {
  const month = normalizeMonth(requestedMonth) || monthKey(new Date());
  return projectLocalUsageSnapshot(config, month, readDocument(config, month));
}

async function readLocalUsageSnapshotAsync(config = {}, requestedMonth = '') {
  const month = normalizeMonth(requestedMonth) || monthKey(new Date());
  return projectLocalUsageSnapshot(config, month, await readDocumentFresh(config, month));
}

function projectLocalUsageSnapshot(config, month, document) {
  const activeDays = new Set(document.hours.map(row => row.hour.slice(0, 10))).size;
  const totals = {
    ...aggregateDto(document.totals),
    requests: number(document.totals.requests),
    requestBytes: 0,
    resultBytes: 0,
    activeDays
  };
  const externalTelemetry = telemetryStatus(config);
  return {
    source: 'local',
    month,
    privacy: {
      retentionDays: LOCAL_ANALYTICS_RETENTION_DAYS,
      externalTelemetry: {
        enabled: externalTelemetry.enabled === true,
        endpointConfigured: externalTelemetry.endpointConfigured === true,
        sampleRatio: number(externalTelemetry.sampleRatio)
      }
    },
    totals,
    tools: document.tools.map(row => ({ tool: row.tool, ...aggregateDto(row) })),
    devices: [{ deviceId: LOCAL_DEVICE_ID, displayName: LOCAL_DEVICE_NAME, ...aggregateDto(document.totals) }],
    workspaces: document.workspaces.map(row => ({ workspace: row.workspace, ...aggregateDto(row) })),
    workspaceDimensions: document.workspaces.map(row => ({
      deviceId: LOCAL_DEVICE_ID,
      displayName: LOCAL_DEVICE_NAME,
      workspace: row.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${row.workspace}`,
      ...aggregateDto(row)
    })),
    workspaceTools: document.workspaceTools.map(row => ({
      deviceId: LOCAL_DEVICE_ID,
      workspace: row.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${row.workspace}`,
      tool: row.tool,
      ...aggregateDto(row)
    })),
    series: document.hours.map(row => ({
      hour: row.hour,
      requests: number(row.requests),
      ...aggregateDto(row),
      requestBytes: 0,
      resultBytes: 0
    })),
    toolSeries: document.hours.flatMap(row => row.tools.map(item => ({ hour: row.hour, tool: item.tool, ...aggregateDto(item) }))),
    workspaceSeries: document.hours.flatMap(row => row.workspaces.map(item => ({
      hour: row.hour,
      deviceId: LOCAL_DEVICE_ID,
      displayName: LOCAL_DEVICE_NAME,
      workspace: item.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${item.workspace}`,
      ...aggregateDto(item)
    }))),
    workspaceToolSeries: document.hours.flatMap(row => row.workspaceTools.map(item => ({
      hour: row.hour,
      deviceId: LOCAL_DEVICE_ID,
      workspace: item.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${item.workspace}`,
      tool: item.tool,
      ...aggregateDto(item)
    }))),
    failureCategories: document.failureCategories.map(item => ({ category: item.category, failures: number(item.failures) })),
    workspaceFailureCategories: document.workspaceFailureCategories.map(item => ({
      deviceId: LOCAL_DEVICE_ID,
      workspace: item.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${item.workspace}`,
      category: item.category,
      failures: number(item.failures)
    })),
    failureCategorySeries: document.hours.flatMap(row => row.failureCategories.map(item => ({ hour: row.hour, category: item.category, failures: number(item.failures) }))),
    workspaceFailureCategorySeries: document.hours.flatMap(row => row.workspaceFailureCategories.map(item => ({
      hour: row.hour,
      deviceId: LOCAL_DEVICE_ID,
      workspace: item.workspace,
      workspaceKey: `${LOCAL_DEVICE_ID}::${item.workspace}`,
      category: item.category,
      failures: number(item.failures)
    })))
  };
}

function readDocument(config, month) {
  migrateLegacyLocalAnalytics(config);
  return withStateDatabase(config, db => readDocumentFromDatabase(db, month));
}

async function readDocumentFresh(config, month) {
  return readDocument(config, month);
}

function readDocumentFromDatabase(db, month) {
  const row = db.prepare('SELECT payload FROM analytics_months WHERE month=?').get(month);
  if (!row) return emptyDocument(month);
  try {
    return parseDocument(row.payload, month);
  } catch {
    return emptyDocument(month);
  }
}

function upsertDocument(db, document, updatedAtMs = Date.now()) {
  db.prepare(`INSERT INTO analytics_months(month,updated_at_ms,payload) VALUES(?,?,?)
    ON CONFLICT(month) DO UPDATE SET updated_at_ms=excluded.updated_at_ms,payload=excluded.payload`)
    .run(document.month, Math.max(0, Math.floor(Number(updatedAtMs) || Date.now())), JSON.stringify(document));
}

function parseDocument(text, month) {
  const parsed = JSON.parse(text);
  const supportedSchema = parsed?.schemaVersion === SCHEMA_VERSION || parsed?.schemaVersion === LEGACY_SCHEMA_VERSION;
  return supportedSchema && parsed?.month === month
    ? sanitizeDocument(parsed, month, { resetReliability: parsed.schemaVersion !== SCHEMA_VERSION })
    : emptyDocument(month);
}

function migrateLegacyLocalAnalytics(config = {}) {
  let migrated = false;
  withStateDatabase(config, db => {
    if (stateMetaValue(db, LEGACY_MIGRATION_KEY, '') === '1') return;
    const directory = statePath(config, 'analytics', 'local');
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d{4}-\d{2}\.json$/.test(entry.name)) continue;
      const month = entry.name.slice(0, 7);
      const file = path.join(directory, entry.name);
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
        upsertDocument(db, parseDocument(fs.readFileSync(file, 'utf8'), month), stat.mtimeMs);
      } catch {}
    }
    setStateMeta(db, LEGACY_MIGRATION_KEY, '1');
    migrated = true;
  }, { transaction: true });
  if (migrated) removeLegacyAnalyticsDirectory(config);
}

async function flushLocalAnalytics() {
  return { ok: true, failed: 0, pending: 0 };
}

function scheduleRetentionPrune(config = {}) {
  const key = statePath(config, 'durable-state.sqlite');
  const now = Date.now();
  if (now - Number(retentionPruneTimes.get(key) || 0) < RETENTION_PRUNE_INTERVAL_MS) return false;
  retentionPruneTimes.set(key, now);
  const timer = setTimeout(() => {
    void pruneLocalAnalytics(config).catch(error => {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] local analytics retention prune:', error);
    });
  }, 0);
  timer.unref?.();
  return true;
}

async function pruneLocalAnalytics(config = {}, options = {}) {
  migrateLegacyLocalAnalytics(config);
  const retentionDays = Math.max(1, Math.floor(Number(options.retentionDays || LOCAL_ANALYTICS_RETENTION_DAYS)));
  const now = options.now instanceof Date ? options.now : new Date(options.now == null ? Date.now() : options.now);
  const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const result = withStateDatabase(config, db => {
    const rows = db.prepare('SELECT month,payload FROM analytics_months').all();
    const remove = db.prepare('DELETE FROM analytics_months WHERE month=?');
    let removedFiles = 0;
    let removedBytes = 0;
    for (const row of rows) {
      if (monthEndMs(row.month) >= cutoffMs) continue;
      removedFiles += 1;
      removedBytes += Buffer.byteLength(String(row.payload || ''), 'utf8');
      remove.run(row.month);
    }
    return { ok: true, removedFiles, removedBytes };
  }, { transaction: true });
  retentionPruneTimes.set(statePath(config, 'durable-state.sqlite'), nowMs);
  return result;
}

async function clearLocalAnalytics(config = {}) {
  migrateLegacyLocalAnalytics(config);
  const result = withStateDatabase(config, db => {
    const rows = db.prepare('SELECT payload FROM analytics_months').all();
    const removedBytes = rows.reduce((sum, row) => sum + Buffer.byteLength(String(row.payload || ''), 'utf8'), 0);
    db.exec('DELETE FROM analytics_months');
    return { ok: true, removedFiles: rows.length, removedBytes };
  }, { transaction: true });
  retentionPruneTimes.delete(statePath(config, 'durable-state.sqlite'));
  removeLegacyAnalyticsDirectory(config);
  return result;
}

function removeLegacyAnalyticsDirectory(config = {}) {
  try { fs.rmSync(statePath(config, 'analytics', 'local'), { recursive: true, force: true }); } catch {}
}

function monthEndMs(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return Number.POSITIVE_INFINITY;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return Number.POSITIVE_INFINITY;
  return Date.UTC(year, monthIndex + 1, 1) - 1;
}

function emptyDocument(month) {
  return { schemaVersion: SCHEMA_VERSION, month, totals: emptyAggregate(true), tools: [], workspaces: [], workspaceTools: [], failureCategories: [], workspaceFailureCategories: [], hours: [] };
}

function sanitizeDocument(value, month, { resetReliability = false } = {}) {
  const doc = emptyDocument(month);
  doc.totals = sanitizeAggregate(value.totals, true, resetReliability);
  doc.tools = sanitizeNamedRows(value.tools, 'tool', resetReliability);
  doc.workspaces = sanitizeNamedRows(value.workspaces, 'workspace', resetReliability);
  doc.workspaceTools = sanitizeWorkspaceTools(value.workspaceTools, resetReliability);
  doc.failureCategories = sanitizeFailureCategories(value.failureCategories);
  doc.workspaceFailureCategories = sanitizeWorkspaceFailureCategories(value.workspaceFailureCategories);
  doc.hours = (Array.isArray(value.hours) ? value.hours : []).filter(row => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(String(row?.hour || ''))).slice(-744).map(row => ({
    hour: String(row.hour),
    ...sanitizeAggregate(row, true, resetReliability),
    tools: sanitizeNamedRows(row.tools, 'tool', resetReliability),
    workspaces: sanitizeNamedRows(row.workspaces, 'workspace', resetReliability),
    workspaceTools: sanitizeWorkspaceTools(row.workspaceTools, resetReliability),
    failureCategories: sanitizeFailureCategories(row.failureCategories),
    workspaceFailureCategories: sanitizeWorkspaceFailureCategories(row.workspaceFailureCategories)
  }));
  return doc;
}

function sanitizeNamedRows(rows, field, resetReliability = false) {
  return (Array.isArray(rows) ? rows : []).slice(0, 512).map(row => ({ [field]: boundedLabel(row?.[field], 160), ...sanitizeAggregate(row, false, resetReliability) })).filter(row => row[field]);
}
function sanitizeWorkspaceTools(rows, resetReliability = false) {
  return (Array.isArray(rows) ? rows : []).slice(0, 2048).map(row => ({ workspace: boundedLabel(row?.workspace, 160), tool: boundedLabel(row?.tool, 160), ...sanitizeAggregate(row, false, resetReliability) })).filter(row => row.workspace && row.tool);
}
function sanitizeFailureCategories(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 32).map(row => ({ category: normalizeFailureCategory(row?.category), failures: number(row?.failures) })).filter(row => row.failures > 0);
}
function sanitizeWorkspaceFailureCategories(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 512).map(row => ({ workspace: boundedLabel(row?.workspace, 160), category: normalizeFailureCategory(row?.category), failures: number(row?.failures) })).filter(row => row.workspace && row.failures > 0);
}
function sanitizeAggregate(row, includeRequests = false, resetReliability = false) {
  const successes = number(row?.successes);
  const failures = number(row?.failures);
  const reliabilityCalls = resetReliability ? 0 : number(row?.reliabilityCalls);
  const reliableCalls = resetReliability ? 0 : number(row?.reliableCalls);
  return {
    ...(includeRequests ? { requests: number(row?.requests) } : {}),
    toolCalls: number(row?.toolCalls),
    successes,
    failures,
    reliabilityCalls,
    reliableCalls,
    infrastructureFailures: resetReliability ? 0 : number(row?.infrastructureFailures),
    operationFailures: resetReliability ? 0 : number(row?.operationFailures),
    recoverableFailures: resetReliability ? 0 : number(row?.recoverableFailures),
    cancellations: resetReliability ? 0 : number(row?.cancellations),
    executionMs: number(row?.executionMs)
  };
}
function aggregateDto(row) {
  return {
    toolCalls: number(row?.toolCalls), successes: number(row?.successes), failures: number(row?.failures),
    reliabilityCalls: number(row?.reliabilityCalls), reliableCalls: number(row?.reliableCalls),
    infrastructureFailures: number(row?.infrastructureFailures), operationFailures: number(row?.operationFailures),
    recoverableFailures: number(row?.recoverableFailures), cancellations: number(row?.cancellations),
    executionMs: number(row?.executionMs)
  };
}
function emptyAggregate(includeRequests = false) {
  return {
    ...(includeRequests ? { requests: 0 } : {}),
    toolCalls: 0, successes: 0, failures: 0,
    reliabilityCalls: 0, reliableCalls: 0, infrastructureFailures: 0,
    operationFailures: 0, recoverableFailures: 0, cancellations: 0,
    executionMs: 0
  };
}
function incrementTotals(row, success, failure, durationMs, reliability) { row.requests = number(row.requests) + 1; incrementAggregate(row, success, failure, durationMs, reliability); }
function incrementNamed(rows, field, value, success, failure, durationMs, reliability) { const row = findOrCreate(rows, item => item[field] === value, () => ({ [field]: value, ...emptyAggregate() })); incrementAggregate(row, success, failure, durationMs, reliability); }
function incrementWorkspaceTool(rows, workspace, tool, success, failure, durationMs, reliability) { const row = findOrCreate(rows, item => item.workspace === workspace && item.tool === tool, () => ({ workspace, tool, ...emptyAggregate() })); incrementAggregate(row, success, failure, durationMs, reliability); }
function incrementFailureCategory(rows, category) { const normalized = normalizeFailureCategory(category); const row = findOrCreate(rows, item => item.category === normalized, () => ({ category: normalized, failures: 0 })); row.failures = number(row.failures) + 1; }
function incrementWorkspaceFailureCategory(rows, workspace, category) { const normalized = normalizeFailureCategory(category); const row = findOrCreate(rows, item => item.workspace === workspace && item.category === normalized, () => ({ workspace, category: normalized, failures: 0 })); row.failures = number(row.failures) + 1; }
function incrementAggregate(row, success, failure, durationMs, reliability = {}) {
  row.toolCalls = number(row.toolCalls) + 1;
  row.successes = number(row.successes) + success;
  row.failures = number(row.failures) + failure;
  for (const key of ['reliabilityCalls', 'reliableCalls', 'infrastructureFailures', 'operationFailures', 'recoverableFailures', 'cancellations']) {
    row[key] = number(row[key]) + number(reliability[key]);
  }
  row.executionMs = number(row.executionMs) + durationMs;
}
function findOrCreate(rows, predicate, create) { let row = rows.find(predicate); if (!row) { row = create(); rows.push(row); } return row; }
function boundedDate(value) { const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value); return Number.isFinite(date.getTime()) ? date : new Date(); }
function boundedDuration(value) { const n = Number(value); return Number.isFinite(n) ? Math.min(MAX_DURATION_MS, Math.max(0, Math.round(n))) : 0; }
function boundedLabel(value, max) { return String(value || '').trim().slice(0, max); }
function number(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }
function monthKey(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }
function hourKey(date) { return `${monthKey(date)}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}`; }
function normalizeMonth(value) { const text = String(value || '').trim(); return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : ''; }

export {
  LOCAL_ANALYTICS_RETENTION_DAYS,
  clearLocalAnalytics,
  flushLocalAnalytics,
  pruneLocalAnalytics,
  recordLocalToolOutcome,
  readLocalUsageSnapshot,
  readLocalUsageSnapshotAsync
};
