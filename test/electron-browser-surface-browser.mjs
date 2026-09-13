import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-embedded-browser-'));
const outputPath = path.join(temp, 'probe.json');
const electronBinary = process.env.RELAI_ELECTRON_BINARY || path.resolve(
  root,
  'electron',
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
);
assert.equal(fs.existsSync(electronBinary), true, `Electron binary not found at ${electronBinary}`);

const child = spawn(electronBinary, [
  '--no-sandbox',
  '--disable-gpu',
  `--user-data-dir=${path.join(temp, 'profile')}`,
  path.join(root, 'test', 'fixtures', 'electron-browser-surface-probe')
], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, RELAI_PROBE_OUTPUT_PATH: outputPath, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
});
let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

try {
  const result = await waitForChildClose(child, 60_000);
  const code = result[0];
  if (code === 'timeout') {
    const probeOutput = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '(probe output missing)';
    child.kill('SIGKILL');
    assert.fail(`Embedded browser Electron probe timed out. probe=${probeOutput} stdout=${stdout} stderr=${stderr}`);
  }
  assert.equal(code, 0, `Embedded browser Electron probe failed. stdout=${stdout} stderr=${stderr}`);
  const probe = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(probe.error, undefined, probe.error);
  assert.equal(probe.started.browserProduct, 'Rel.AI Embedded Chromium');
  assert.equal(probe.positioned.active, true);
  assert.equal(probe.positioned.visible, true, 'A real WebContentsView must attach inside the dashboard BrowserWindow.');
  assert.equal(probe.positioned.tabs.length, 2, 'Real Electron browser state must expose both open tabs.');
  assert.equal(probe.tabState.nativePageId, probe.tabState.tabs[0].nativePageId, 'Selecting a tab must switch the attached WebContentsView.');
  assert.equal(probe.tabState.tabs[0].active, true);
  assert.equal(probe.afterTabClose.tabs.length, 1, 'Closing a desktop tab must remove the native page from state.');
  assert.equal(probe.navigated.url.startsWith('http://127.0.0.1:'), true);
  assert.equal(probe.navigated.title, 'Embedded fixture');
  assert.match(probe.snapshot, /Embedded browser fixture/);
  assert.match(probe.afterFill, /Rel\.AI embedded/);
  assert.ok(probe.screenshotBytes > 0, 'Embedded page screenshot must contain image data.');
  assert.ok(probe.screenshotWidth > 0 && probe.screenshotHeight > 0, 'Embedded page screenshot dimensions must be positive.');
  assert.equal(probe.userState.control, 'user');
  assert.equal(probe.takeoverError?.code, 'BROWSER_USER_CONTROL_ACTIVE');
  assert.equal(probe.aiState.control, 'ai');
  assert.equal(probe.finalState.active, true);
  assert.equal(probe.finalState.visible, true);
  assert.equal(probe.windowVisible, true, 'The Electron probe window must be render-active for WebContentsView painting.');
  assert.equal(probe.windowOpacity, 0, 'The real Electron browser probe must remain fully transparent so tests never flash a blank or black window on the user desktop.');
  assert.equal(probe.windowFocused, false, 'The invisible browser probe must never steal user focus.');
  assert.ok(probe.stateCount >= 4, 'Embedded surface must publish lifecycle and navigation state.');
  assert.equal(probe.events.length, 1);
  assert.equal(probe.events[0].type, 'page_closed');
  console.log('Real Electron WebContentsView browser surface renders, automates, screenshots, and hands control to the user.');
} finally {
  if (child.exitCode == null) child.kill('SIGKILL');
  await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
}

function waitForChildClose(childProcess, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => finish(['timeout']), timeoutMs);
    childProcess.once('close', (...args) => finish(args));

    function finish(result) {
      clearTimeout(timer);
      resolve(result);
    }
  });
}
