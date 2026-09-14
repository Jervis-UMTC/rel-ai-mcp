import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openIndexDatabase, repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-repository-worker-termination-'));
const workspaceRoot = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
const sourceRoot = path.join(workspaceRoot, 'src');
fs.mkdirSync(sourceRoot, { recursive: true });

for (let index = 0; index < 1500; index += 1) {
  const functions = Array.from({ length: 20 }, (_, item) =>
    `export function symbol_${index}_${item}(value) { return value + ${index + item}; }`).join('\n');
  fs.writeFileSync(path.join(sourceRoot, `module-${String(index).padStart(4, '0')}.js`), `${functions}\n`);
}

const workspace = { alias: 'worker-termination', path: workspaceRoot, context: {} };
const config = { stateDir };
const databaseFile = repositoryIndexPath(config, workspace);

try {
  const build = repositoryIntelligence.ensure(workspace, config, {
    force: true,
    watch: false,
    maxFiles: 1500
  });

  const buildingGeneration = await waitForBuildingGeneration(databaseFile);
  assert.ok(buildingGeneration > 0, 'the test must observe a live worker generation before terminating it');

  const rejectedBuild = assert.rejects(
    build,
    error => error?.name === 'AbortError' || error?.code === 'INDEX_ABORTED'
  );
  await repositoryIntelligence.shutdown();
  await rejectedBuild;

  const db = openIndexDatabase(databaseFile, { readonly: true });
  try {
    assert.equal(Number(db.prepare("SELECT count(*) AS count FROM generations WHERE status='building'").get()?.count || 0), 0,
      'forced worker termination must not leave a generation permanently marked as building');
    const row = db.prepare('SELECT status, completed_at, error_message FROM generations WHERE id=?').get(buildingGeneration);
    assert.equal(row?.status, 'failed');
    assert.ok(row?.completed_at, 'recovered generation must record its completion time');
    assert.ok(row?.error_message, 'recovered generation must preserve the termination reason');
  } finally {
    db.close();
  }
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

async function waitForBuildingGeneration(databaseFile) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (fs.existsSync(databaseFile)) {
      let db = null;
      try {
        db = openIndexDatabase(databaseFile, { readonly: true });
        const row = db.prepare("SELECT id FROM generations WHERE status='building' ORDER BY id DESC LIMIT 1").get();
        if (row?.id) return Number(row.id);
      } catch {
        // The worker may still be creating the schema.
      } finally {
        try { db?.close(); } catch {}
      }
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for a live Repository Intelligence generation.');
}

console.log('Repository Intelligence forced worker termination finalizes abandoned generations.');
