import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getStateDir } from './statePaths.js';
import { principalFingerprint } from './mcp/principal.js';

const OUTPUT_SPILL_DIR = 'output-spills';
const OUTPUT_REF_PATTERN = /^spill_[A-Za-z0-9_-]{20,80}$/;
const MAX_OUTPUT_SPILL_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_SPILL_BYTES = 256 * 1024 * 1024;
const MAX_SPILL_FILES = 100;
const SPILL_TTL_MS = 24 * 60 * 60 * 1000;
const spillUsageByRoot = new Map();

function outputSpillOwner({ taskId = '', workspace = '', principal = '' } = {}) {
  const task = String(taskId || '').trim();
  if (task) return task;
  const workspaceId = String(workspace || '').trim();
  if (!workspaceId) return '';
  return `workspace:${workspaceId}:principal:${principalFingerprint(principal || 'local:trusted')}`;
}

function createOutputSpillWriter(config = {}, ownerId = '') {
  const owner = String(ownerId || '').trim();
  const root = spillRoot(config);
  let fd = null;
  let file = '';
  let outputRef = '';
  let bytes = 0;
  let spillTruncated = false;

  function start(initial) {
    if (!owner || fd !== null) return;
    spillUsageByRoot.set(root, pruneOutputSpills(root));
    const directory = path.join(root, taskDirectoryName(owner));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    outputRef = `spill_${crypto.randomBytes(18).toString('base64url')}`;
    file = path.join(directory, `${outputRef}.log`);
    fd = fs.openSync(file, 'wx', 0o600);
    append(initial);
  }

  function append(value) {
    if (fd === null) return;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
    if (!chunk.length) return;
    const fileRemaining = Math.max(0, MAX_OUTPUT_SPILL_BYTES - bytes);
    const totalBytes = spillUsageByRoot.get(root) ?? MAX_TOTAL_SPILL_BYTES;
    const globalRemaining = Math.max(0, MAX_TOTAL_SPILL_BYTES - totalBytes);
    const remaining = Math.min(fileRemaining, globalRemaining);
    if (!remaining) {
      spillTruncated = true;
      return;
    }
    const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    fs.writeSync(fd, accepted);
    bytes += accepted.length;
    spillUsageByRoot.set(root, totalBytes + accepted.length);
    if (accepted.length < chunk.length) spillTruncated = true;
  }

  function finish() {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
      fd = null;
    }
    if (!outputRef) return null;
    return { outputRef, bytes, spillTruncated };
  }

  return { start, append, finish };
}

function readOutputSpill(config = {}, ownerId = '', outputRef = '') {
  const owner = String(ownerId || '').trim();
  const ref = String(outputRef || '').trim();
  if (!owner) throw new Error('relai_read outputRef requires an authorized workspace execution scope.');
  if (!OUTPUT_REF_PATTERN.test(ref)) throw new Error('Invalid Rel.AI outputRef.');
  const file = path.join(spillRoot(config), taskDirectoryName(owner), `${ref}.log`);
  let stat;
  try { stat = fs.statSync(file); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Rel.AI outputRef was not found for this authorized execution scope.', { cause: error });
    throw error;
  }
  if (!stat.isFile()) throw new Error('Rel.AI outputRef does not identify a readable spill.');
  return { outputRef: ref, file, bytes: stat.size };
}

function spillRoot(config) {
  return path.join(getStateDir(config), OUTPUT_SPILL_DIR);
}

function taskDirectoryName(taskId) {
  return crypto.createHash('sha256').update(String(taskId)).digest('hex').slice(0, 32);
}

function pruneOutputSpills(root) {
  let files = [];
  const directories = [];
  try {
    if (!fs.existsSync(root)) return 0;
    for (const directory of fs.readdirSync(root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const base = path.join(root, directory.name);
      directories.push(base);
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
        const file = path.join(base, entry.name);
        try {
          const stat = fs.statSync(file);
          files.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {}
      }
    }
  } catch {
    return MAX_TOTAL_SPILL_BYTES;
  }

  const cutoff = Date.now() - SPILL_TTL_MS;
  const retained = [];
  for (const item of files) {
    if (item.mtimeMs >= cutoff) {
      retained.push(item);
      continue;
    }
    try { fs.rmSync(item.file, { force: true }); }
    catch { retained.push(item); }
  }
  files = retained.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = files.reduce((sum, item) => sum + item.size, 0);
  const targetBytes = Math.max(0, MAX_TOTAL_SPILL_BYTES - MAX_OUTPUT_SPILL_BYTES);
  const targetFiles = Math.max(0, MAX_SPILL_FILES - 1);
  while (files.length > targetFiles || total > targetBytes) {
    const item = files.shift();
    if (!item) break;
    try {
      fs.rmSync(item.file, { force: true });
      total -= item.size;
    } catch {}
  }
  for (const directory of directories) {
    try { fs.rmdirSync(directory); } catch {}
  }
  return Math.max(0, total);
}

export { createOutputSpillWriter, outputSpillOwner, readOutputSpill };
