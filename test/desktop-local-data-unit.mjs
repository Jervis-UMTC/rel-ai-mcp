import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDesktopLocalDataManager } from '../electron/desktop-local-data.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-local-data-'));
const stateDir = path.join(root, 'state');
const connectionStateDir = path.join(root, 'connection-state');
const userDataDir = path.join(root, 'electron-user-data');
const projectDir = path.join(root, 'project');
const logPath = path.join(root, 'service.log');
const auditPath = path.join(stateDir, 'audit.jsonl');
let activeTaskCount = 0;
let openedPath = '';

function write(relative, bytes) {
  const target = path.join(stateDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'x'.repeat(bytes));
}

try {
  write('sessions/task.json', 11);
  write('audit.jsonl', 13);
  write('audit.jsonl.1', 17);
  write('output-spills/task/output.log', 19);
  write('repository-intelligence/repo/graph.db', 23);
  fs.writeFileSync(logPath, 'x'.repeat(29));
  fs.mkdirSync(connectionStateDir, { recursive: true });
  fs.writeFileSync(path.join(connectionStateDir, 'connection.json'), '{}');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'desktop-lifecycle.json'), '{}');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'keep.txt'), 'project data');

  const manager = createDesktopLocalDataManager({
    getAdditionalDataRoots: () => [connectionStateDir],
    getConfig: () => ({ stateDir, auditLogPath: auditPath, workspaces: { app: { path: projectDir } } }),
    getServiceLogPath: () => logPath,
    getTaskActivity: () => ({ activeTaskCount }),
    getUserDataPath: () => userDataDir,
    openPath: async target => { openedPath = target; return ''; }
  });

  const usage = await manager.getUsage();
  assert.equal(usage.ok, true);
  assert.equal(usage.categories.history.bytes, 41);
  assert.equal(usage.categories.logs.bytes, 29);
  assert.equal(usage.categories.temporary.bytes, 19);
  assert.equal(usage.categories.indexes.bytes, 23);
  assert.equal(usage.totalBytes, 112);

  activeTaskCount = 1;
  const blocked = await manager.clearTemporary();
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /task is still active/i);
  assert.equal(fs.existsSync(path.join(stateDir, 'output-spills')), true);

  activeTaskCount = 0;
  const cleared = await manager.clearTemporary();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.categories.temporary.bytes, 0);
  assert.equal(fs.existsSync(path.join(stateDir, 'output-spills')), false);

  assert.equal((await manager.openDataFolder()).ok, true);
  assert.equal(openedPath, path.resolve(stateDir));

  const plan = manager.prepareClearAll();
  assert.equal(plan.ok, true);
  assert.deepEqual(new Set(plan.roots), new Set([path.resolve(stateDir), path.resolve(connectionStateDir), path.resolve(userDataDir)]));
  const allCleared = await manager.clearAll(plan);
  assert.equal(allCleared.ok, true);
  assert.equal(fs.existsSync(stateDir), false);
  assert.equal(fs.existsSync(connectionStateDir), false);
  assert.equal(fs.existsSync(userDataDir), false);
  assert.equal(fs.readFileSync(path.join(projectDir, 'keep.txt'), 'utf8'), 'project data');

  const unsafe = createDesktopLocalDataManager({
    getConfig: () => ({ stateDir: root, workspaces: { app: { path: projectDir } } }),
    getTaskActivity: () => ({ activeTaskCount: 0 }),
    getUserDataPath: () => path.join(root, 'other-user-data')
  });
  assert.throws(() => unsafe.prepareClearAll(), /contains project files/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Desktop local data controls unit tests passed.');
