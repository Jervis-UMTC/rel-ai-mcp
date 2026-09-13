import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generator = path.join(root, 'scripts', 'generate-color-tokens.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-color-token-staleness-'));
const generatedPaths = [
  'src/ui/styles/color-tokens.css',
  'electron/renderer/color-tokens.css',
  'docs/color-system-reference.svg'
];
const originals = new Map();

for (const relativePath of generatedPaths) {
  const source = path.join(root, relativePath);
  const target = path.join(tempRoot, relativePath);
  const original = fs.readFileSync(source, 'utf8');
  originals.set(relativePath, original);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, original, 'utf8');
}

function run(...args) {
  return spawnSync(process.execPath, [generator, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, REL_AI_COLOR_OUTPUT_ROOT: tempRoot }
  });
}

try {
  assert.equal(run('--check').status, 0, 'fresh generated color assets must pass verification');

  const staleRelativePath = 'src/ui/styles/color-tokens.css';
  const stalePath = path.join(tempRoot, staleRelativePath);
  fs.writeFileSync(stalePath, `${originals.get(staleRelativePath)}\n/* intentional stale-asset probe */\n`, 'utf8');
  const stale = run('--check');
  assert.notEqual(stale.status, 0, 'stale generated color assets must fail verification');
  assert.match(`${stale.stdout}\n${stale.stderr}`, /src\/ui\/styles\/color-tokens\.css/);

  const regenerated = run();
  assert.equal(regenerated.status, 0, regenerated.stderr || regenerated.stdout);
  for (const relativePath of generatedPaths) {
    assert.equal(
      fs.readFileSync(path.join(tempRoot, relativePath), 'utf8'),
      originals.get(relativePath),
      `${relativePath} must be restored to the canonical generated content exactly`
    );
  }
  assert.equal(run('--check').status, 0, 'verification must pass after regeneration');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Generated color-asset staleness detection and repair tests passed.');
