import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const probe = path.join(staging, 'probe.mjs');
  const worker = path.join(staging, 'worker.mjs');
  fs.writeFileSync(worker, 'export default value => value + 1;');
  fs.writeFileSync(probe, `
import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/ajv.js';
import Piscina from 'piscina';
import { createMessageConnection } from 'vscode-jsonrpc/node';
import { fileURLToPath } from 'node:url';

const validate = new Ajv().compile({ type: 'integer' });
assert.equal(validate(1), true);
assert.equal(validate('1'), false);
assert.equal(typeof createMessageConnection, 'function');
const pool = new Piscina({ filename: fileURLToPath(new URL('./worker.mjs', import.meta.url)), minThreads: 1, maxThreads: 1 });
try {
  assert.equal(await pool.run(41), 42);
} finally {
  await pool.destroy();
}
`);
  await import(`${pathToFileURL(probe).href}?packagedDependencyProbe=${Date.now()}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

console.log('Packaged validation, repository worker, and JSON-RPC dependencies passed.');
