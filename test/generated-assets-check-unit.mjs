import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(root, 'scripts', 'check-generated.mjs');
const sourcePublic = path.join(root, 'public');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-generated-assets-check-'));
const testPublic = path.join(tempRoot, 'public');
const dashboardCss = path.join(testPublic, 'dashboard.css');
const dashboardReact = path.join(testPublic, 'dashboard-react.js');
const dashboardChunks = path.join(testPublic, 'dashboard-chunks');
const staleChunkProbe = path.join(dashboardChunks, 'intentional-stale-generated-probe.js');

copyGeneratedAssets(sourcePublic, testPublic);
const originalCss = fs.readFileSync(dashboardCss);
const originalReact = fs.readFileSync(dashboardReact);

function runCheck(publicRoot = '') {
  return spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: publicRoot
      ? { ...process.env, REL_AI_GENERATED_PUBLIC_ROOT: publicRoot }
      : process.env
  });
}

function copyGeneratedAssets(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of ['dashboard-app.js', 'dashboard-react.js', 'dashboard.css']) {
    fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
  for (const name of ['dashboard-chunks', 'dashboard-assets']) {
    const source = path.join(from, name);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(to, name), { recursive: true });
  }
}

try {
  const fresh = runCheck();
  assert.equal(fresh.status, 0, fresh.stderr || fresh.stdout);

  const isolatedFresh = runCheck(testPublic);
  assert.equal(isolatedFresh.status, 0, isolatedFresh.stderr || isolatedFresh.stdout);
  assert.deepEqual(fs.readFileSync(dashboardCss), originalCss, 'verification must not rewrite fresh generated CSS');
  assert.deepEqual(fs.readFileSync(dashboardReact), originalReact, 'verification must not rewrite the fresh React bundle');

  const staleCss = Buffer.concat([originalCss, Buffer.from('\n/* intentional stale dashboard probe */\n')]);
  fs.writeFileSync(dashboardCss, staleCss);
  const staleCssCheck = runCheck(testPublic);
  assert.notEqual(staleCssCheck.status, 0, 'stale dashboard CSS must fail generated-asset verification');
  assert.match(`${staleCssCheck.stdout}\n${staleCssCheck.stderr}`, /Generated dashboard assets are stale/i);
  assert.deepEqual(fs.readFileSync(dashboardCss), staleCss, 'verification must report stale CSS without repairing it');
  fs.writeFileSync(dashboardCss, originalCss);

  const staleReact = Buffer.concat([originalReact, Buffer.from('\n// intentional stale React bundle probe\n')]);
  fs.writeFileSync(dashboardReact, staleReact);
  const staleReactCheck = runCheck(testPublic);
  assert.notEqual(staleReactCheck.status, 0, 'stale dashboard React JS must fail generated-asset verification');
  assert.match(`${staleReactCheck.stdout}\n${staleReactCheck.stderr}`, /Generated dashboard assets are stale/i);
  assert.deepEqual(fs.readFileSync(dashboardReact), staleReact, 'verification must report stale React JS without repairing it');
  fs.writeFileSync(dashboardReact, originalReact);

  fs.mkdirSync(dashboardChunks, { recursive: true });
  fs.writeFileSync(staleChunkProbe, 'export const stale = true;\n');
  const staleChunkCheck = runCheck(testPublic);
  assert.notEqual(staleChunkCheck.status, 0, 'unexpected dashboard chunks must fail generated-asset verification');
  assert.match(`${staleChunkCheck.stdout}\n${staleChunkCheck.stderr}`, /Generated dashboard assets are stale/i);
  assert.equal(fs.existsSync(staleChunkProbe), true, 'verification must report stale chunks without repairing them');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Generated dashboard verification is deterministic and non-destructive.');
