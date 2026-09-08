import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stateExport, stateImport } from '../src/productUx.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-state-backup-'));
const sourceDir = path.join(temp, 'source');
const restoredDir = path.join(temp, 'restored');
fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
fs.writeFileSync(path.join(sourceDir, 'root-state.json'), '{"root":true}\n');
fs.writeFileSync(path.join(sourceDir, 'nested', 'child.txt'), 'nested-state\n');
const largeState = Buffer.alloc(1024 * 1024 + 4096, 0xff);
fs.writeFileSync(path.join(sourceDir, 'durable-state.sqlite'), largeState);

try {
  const exported = stateExport({ stateDir: sourceDir }).export;
  assert.equal(exported.version, 2);
  assert.ok(exported.files.some(item => item.path === 'root-state.json'), 'root-level state files must be exported');
  const exportedSqlite = exported.files.find(item => item.path === 'durable-state.sqlite');
  assert.equal(exportedSqlite?.encoding, 'base64', 'large binary state must be exported instead of silently omitted');

  const imported = stateImport({ stateDir: restoredDir }, { confirm: true, payload: exported });
  assert.equal(imported.ok, true);
  assert.equal(fs.readFileSync(path.join(restoredDir, 'root-state.json'), 'utf8'), '{"root":true}\n');
  assert.deepEqual(fs.readFileSync(path.join(restoredDir, 'durable-state.sqlite')), largeState);

  fs.writeFileSync(path.join(restoredDir, 'root-state.json'), 'original\n');
  const invalidPayload = {
    version: 2,
    files: [
      { path: 'root-state.json', content: 'replacement\n' },
      { path: 'nested/bad.bin', encoding: 'base64', content: 'not-valid-base64!' }
    ]
  };
  assert.throws(() => stateImport({ stateDir: restoredDir }, { confirm: true, payload: invalidPayload }), /Invalid base64/);
  assert.equal(fs.readFileSync(path.join(restoredDir, 'root-state.json'), 'utf8'), 'original\n', 'failed imports must leave the existing state untouched');

  assert.throws(
    () => stateImport({ stateDir: restoredDir }, { confirm: true, payload: { version: 999, files: [{ path: 'root-state.json', content: 'future\n' }] } }),
    /Unsupported state import version/
  );
  assert.equal(fs.readFileSync(path.join(restoredDir, 'root-state.json'), 'utf8'), 'original\n');

  assert.throws(
    () => stateExport({ stateDir: sourceDir }, { maxFileBytes: 1024 * 1024 }),
    /exceeds the maximum size/,
    'an explicit export size limit must fail closed instead of producing an incomplete backup'
  );

  console.log('State backup export/import regression tests passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
