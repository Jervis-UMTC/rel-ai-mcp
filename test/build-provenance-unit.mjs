import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildIdFromFingerprint, createBuildProvenance, normalizeBuildProvenance, readRepositoryBuildState } from '../src/buildProvenance.js';
import { readBuildStatus } from '../electron/build-provenance.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-build-provenance-'));
const detachedResources = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-build-provenance-detached-'));

try {
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Rel.AI Test']);
  git(['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(root, '.gitignore'), '/dist\n', 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"rel-ai-mcp","version":"1.2.3"}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'app.txt'), 'baseline\n', 'utf8');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'baseline']);

  const baseline = await readRepositoryBuildState(root);
  assert.equal(baseline.dirty, false);
  assert.match(baseline.sourceRevision, /^[a-f0-9]{40,64}$/);
  assert.match(baseline.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(await readRepositoryBuildState(root), baseline, 'unchanged source must keep the same fingerprint');

  const provenance = await createBuildProvenance(root, { version: '1.2.3', builtAt: '2026-09-15T12:00:00.000Z' });
  assert.equal(provenance.sourceFingerprint, baseline.sourceFingerprint);
  assert.equal(buildIdFromFingerprint(provenance.sourceFingerprint), baseline.sourceFingerprint.slice(0, 12));
  assert.equal(provenance.dirty, false);
  assert.deepEqual(normalizeBuildProvenance(provenance), provenance);
  assert.equal(normalizeBuildProvenance({ ...provenance, sourceFingerprint: 'bad' }), null);

  fs.writeFileSync(path.join(root, 'app.txt'), 'changed\n', 'utf8');
  const changed = await readRepositoryBuildState(root);
  assert.equal(changed.dirty, true);
  assert.notEqual(changed.sourceFingerprint, baseline.sourceFingerprint, 'tracked edits must invalidate a build');

  git(['add', 'app.txt']);
  const staged = await readRepositoryBuildState(root);
  assert.equal(staged.dirty, true);
  assert.notEqual(staged.sourceFingerprint, baseline.sourceFingerprint, 'staged edits must invalidate a build');
  assert.equal(staged.sourceFingerprint, changed.sourceFingerprint, 'staging the same file contents must not change build identity');

  git(['commit', '--quiet', '-m', 'same changed source']);
  const committed = await readRepositoryBuildState(root);
  assert.equal(committed.dirty, false);
  assert.equal(committed.sourceFingerprint, changed.sourceFingerprint, 'committing unchanged file contents must not change build identity');
  git(['reset', '--hard', '--quiet', 'HEAD^']);
  fs.writeFileSync(path.join(root, 'new-feature.txt'), 'untracked feature\n', 'utf8');
  const untracked = await readRepositoryBuildState(root);
  assert.equal(untracked.dirty, true);
  assert.notEqual(untracked.sourceFingerprint, baseline.sourceFingerprint, 'untracked source files must invalidate a build');
  fs.rmSync(path.join(root, 'new-feature.txt'));
  assert.equal((await readRepositoryBuildState(root)).sourceFingerprint, baseline.sourceFingerprint, 'restoring source must restore the fingerprint');

  const resources = path.join(root, 'dist', 'build-check', 'win-unpacked', 'resources');
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, 'build-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  const app = { isPackaged: true, getVersion: () => '1.2.3' };
  const buildStatus = readBuildStatus({ app, resourcesPath: resources });
  assert.equal(buildStatus.state, 'recorded');
  assert.equal(buildStatus.buildId, provenance.sourceFingerprint.slice(0, 12), 'packaged builds must expose a stable source-derived build ID');

  fs.writeFileSync(path.join(root, 'app.txt'), 'changed after build\n', 'utf8');
  assert.equal(readBuildStatus({ app, resourcesPath: resources }).buildId, buildStatus.buildId, 'a package keeps the identity of the source snapshot it was built from');
  git(['reset', '--hard', '--quiet', 'HEAD']);

  fs.writeFileSync(path.join(detachedResources, 'build-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  assert.equal(readBuildStatus({ app, resourcesPath: detachedResources }).buildId, buildStatus.buildId, 'installed builds must expose the same build ID without needing a source checkout');
  assert.equal(readBuildStatus({ app: { isPackaged: false } }).state, 'development');

  console.log('Build provenance and package identity tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(detachedResources, { recursive: true, force: true });
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
