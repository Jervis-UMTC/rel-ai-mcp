import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { removeControllerRuntimeMarker, writeControllerRuntimeMarker } from '../electron/controller-runtime.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-controller-runtime-'));
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_STATE_DIR = stateDir;

const markerPath = path.join(stateDir, 'controller-runtime.json');
const temporaryPath = `${markerPath}.${process.pid}.tmp`;
const app = {
  isPackaged: false,
  getVersion: () => '0.28.0',
  getAppPath: () => path.resolve('.')
};

try {
  const first = await writeControllerRuntimeMarker(app);
  assert.equal(first.pid, process.pid);
  assert.equal(first.schemaVersion, 1);
  assert.equal(JSON.parse(fs.readFileSync(markerPath, 'utf8')).pid, process.pid);
  assert.equal(fs.existsSync(temporaryPath), false, 'successful marker writes must not leave temporary files behind');

  await writeControllerRuntimeMarker(app);
  assert.equal(JSON.parse(fs.readFileSync(markerPath, 'utf8')).pid, process.pid,
    'rewriting the active marker must replace it without a delete-before-rename gap');
  assert.equal(fs.existsSync(temporaryPath), false);

  fs.writeFileSync(markerPath, `${JSON.stringify({ schemaVersion: 1, pid: process.pid + 1 })}\n`);
  assert.equal(await removeControllerRuntimeMarker(), false,
    'one controller must never remove a marker owned by another process');
  assert.equal(fs.existsSync(markerPath), true);

  await writeControllerRuntimeMarker(app);
  assert.equal(await removeControllerRuntimeMarker(), true);
  assert.equal(fs.existsSync(markerPath), false);
} finally {
  if (previousStateDir === undefined) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Controller runtime marker replacement and ownership tests passed.');
