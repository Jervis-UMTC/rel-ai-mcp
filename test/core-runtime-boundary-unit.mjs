import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRelaiCoreRuntime } from '../src/core/runtime.ts';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-core-runtime-'));
const stateDir = path.join(temp, 'state');
const workspacePath = path.join(temp, 'workspace');
fs.mkdirSync(workspacePath, { recursive: true });
const config = {
  version: 3,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {
    repo: { path: workspacePath, commands: {}, testCommands: {} }
  }
};

try {
  const runtime = createRelaiCoreRuntime({ config });
  const firstStart = runtime.start();
  assert.equal(firstStart.config, config);
  assert.equal(firstStart.isolated, false);
  assert.equal(firstStart.state.ok, true);
  assert.equal(runtime.start(), firstStart, 'core runtime startup must be idempotent');

  const firstShutdown = runtime.shutdown();
  assert.equal(runtime.shutdown(), firstShutdown, 'core runtime shutdown must be idempotent');
  const cleanup = await firstShutdown;
  assert.equal(cleanup.clean, true, JSON.stringify(cleanup));
  assert.equal(cleanup.managedProcesses.orphaned, 0, JSON.stringify(cleanup));
  assert.equal(cleanup.repositoryIntelligence.closed, true, JSON.stringify(cleanup));
  assert.deepEqual(cleanup.errors, []);

  const isolatedRuntime = createRelaiCoreRuntime({ config, isolated: true });
  assert.equal(isolatedRuntime.start().isolated, true);
  const isolatedCleanup = await isolatedRuntime.shutdown();
  assert.equal(isolatedCleanup.clean, true);
  assert.equal(isolatedCleanup.managedProcesses.skipped, true);
  assert.equal(isolatedCleanup.repositoryIntelligence.skipped, true);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Rel.AI core runtime starts and shuts down without Electron dependencies.');
