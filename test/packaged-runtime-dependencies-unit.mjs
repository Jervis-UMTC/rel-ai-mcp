import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-packaged-dependencies-'));
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'electron/package.json'), 'utf8'));
const filters = manifest.build.extraResources.find(resource => resource.to === 'node_modules').filter;
const copied = new Set();

function copyDependency(name) {
  if (copied.has(name)) return;
  copied.add(name);
  const source = path.join(repo, 'node_modules', name);
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  fs.cpSync(source, path.join(staging, 'node_modules', name), {
    recursive: true,
    filter: candidate => {
      if (fs.statSync(candidate).isDirectory()) return true;
      const relative = path.relative(path.join(repo, 'node_modules'), candidate).replaceAll('\\', '/');
      return filters.some(pattern => !pattern.startsWith('!') && path.matchesGlob(relative, pattern))
        && !filters.some(pattern => pattern.startsWith('!') && path.matchesGlob(relative, pattern.slice(1)));
    }
  });
  for (const dependency of Object.keys(metadata.dependencies || {})) copyDependency(dependency);
}

try {
  for (const name of ['ajv', 'piscina', 'vscode-jsonrpc']) copyDependency(name);
  const require = createRequire(path.join(staging, 'probe.cjs'));
  const { Ajv } = require('ajv/dist/ajv.js');
  const validate = new Ajv().compile({ type: 'integer' });
  assert.equal(validate(1), true);
  assert.equal(validate('1'), false);
  assert.equal(typeof require('vscode-jsonrpc/node').createMessageConnection, 'function');
  const Piscina = require('piscina');
  const worker = path.join(staging, 'worker.cjs');
  fs.writeFileSync(worker, 'module.exports = value => value + 1;');
  const pool = new Piscina({ filename: worker, minThreads: 1, maxThreads: 1 });
  try {
    assert.equal(await pool.run(41), 42);
  } finally {
    await pool.destroy();
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

console.log('Packaged validation, repository worker, and JSON-RPC dependencies passed.');
