import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createDesktopOsOperations } from '../electron/desktop-os-operations.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-desktop-os-'));
const file = path.join(root, 'proposal.docx');
fs.writeFileSync(file, 'proposal');

const shellCalls = [];
let openPathFailure = '';
const shell = {
  async openPath(target) {
    shellCalls.push(['openPath', target]);
    return openPathFailure;
  },
  showItemInFolder(target) {
    shellCalls.push(['showItemInFolder', target]);
  },
  async openExternal(uri) {
    shellCalls.push(['openExternal', uri]);
  }
};
let clipboardText = 'local clipboard';
const clipboard = {
  readText() { return clipboardText; },
  writeText(value) { clipboardText = value; }
};
const spawnCalls = [];
const windowsSpawn = (executable, argv, options) => {
  spawnCalls.push({ executable, argv, options });
  const child = new EventEmitter();
  child.unref = () => { child.unrefCalled = true; };
  queueMicrotask(() => child.emit('spawn'));
  return child;
};

try {
  const operations = createDesktopOsOperations({ shell, clipboard, platform: 'win32', spawn: windowsSpawn });
  assert.deepEqual(await operations.run({ action: 'open_path', path: file }), { ok: true, platform: 'win32' });
  assert.deepEqual(shellCalls.at(-1), ['openPath', file]);

  openPathFailure = 'No application is associated with this file.';
  await assert.rejects(() => operations.run({ action: 'open_path', path: file }), /No application is associated/i);
  openPathFailure = '';

  assert.deepEqual(await operations.run({ action: 'reveal_path', path: file }), { ok: true, platform: 'win32' });
  assert.deepEqual(shellCalls.at(-1), ['showItemInFolder', file]);
  await assert.rejects(() => operations.run({ action: 'reveal_path', path: 'relative.txt' }), /must be absolute/i);

  await operations.run({ action: 'open_uri', uri: 'https://example.com/docs' });
  assert.deepEqual(shellCalls.at(-1), ['openExternal', 'https://example.com/docs']);
  await assert.rejects(() => operations.run({ action: 'open_uri', uri: 'not a uri' }), /absolute valid URI/i);
  await assert.rejects(() => operations.run({ action: 'open_uri', uri: 'file:///tmp/secret.txt' }), /protocol is not allowed/i);

  await operations.run({ action: 'launch_application', application: 'notepad.exe' });
  assert.equal(spawnCalls.at(-1).executable, 'notepad.exe');
  assert.deepEqual(spawnCalls.at(-1).argv, []);
  assert.equal(spawnCalls.at(-1).options.shell, false);
  assert.equal(spawnCalls.at(-1).options.detached, true);

  const missingWindows = createDesktopOsOperations({
    shell,
    clipboard,
    platform: 'win32',
    spawn() {
      const child = new EventEmitter();
      queueMicrotask(() => {
        const error = new Error('spawn ENOENT');
        error.code = 'ENOENT';
        child.emit('error', error);
      });
      return child;
    }
  });
  await assert.rejects(
    () => missingWindows.run({ action: 'launch_application', application: 'missing-app.exe' }),
    /could not be launched.*ENOENT/i
  );
  await assert.rejects(
    () => operations.run({ action: 'launch_application', application: 'C:\\Windows\\notepad.exe' }),
    /not a path or command/i
  );

  assert.deepEqual(await operations.run({ action: 'clipboard_read' }), {
    ok: true,
    platform: 'win32',
    text: 'local clipboard'
  });
  await operations.run({ action: 'clipboard_write', text: 'a\u0000b' });
  assert.equal(clipboardText, 'ab');
  await assert.rejects(
    () => operations.run({ action: 'clipboard_write', text: 'x'.repeat(64 * 1024 + 1) }),
    /64 KiB/i
  );

  const linuxMissingLauncher = createDesktopOsOperations({
    shell,
    clipboard,
    platform: 'linux',
    spawn(executable, argv, options) {
      assert.equal(executable, 'gtk-launch');
      assert.deepEqual(argv, ['org.example.App']);
      assert.equal(options.shell, false);
      const child = new EventEmitter();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        const error = new Error('spawn gtk-launch ENOENT');
        error.code = 'ENOENT';
        child.emit('error', error);
      });
      return child;
    }
  });
  await assert.rejects(
    () => linuxMissingLauncher.run({ action: 'launch_application', application: 'org.example.App' }),
    /requires gtk-launch/i
  );

  const macCalls = [];
  const macOperations = createDesktopOsOperations({
    shell,
    clipboard,
    platform: 'darwin',
    spawn(executable, argv, options) {
      macCalls.push({ executable, argv, options });
      const child = new EventEmitter();
      child.stderr = new PassThrough();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    }
  });
  await macOperations.run({ action: 'launch_application', application: 'TextEdit' });
  assert.equal(macCalls[0].executable, '/usr/bin/open');
  assert.deepEqual(macCalls[0].argv, ['-a', 'TextEdit']);
  assert.equal(macCalls[0].options.shell, false);

  const unsupported = createDesktopOsOperations({ shell, clipboard, platform: 'freebsd', spawn: windowsSpawn });
  await assert.rejects(
    () => unsupported.run({ action: 'launch_application', application: 'editor' }),
    /not supported on platform/i
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Electron structured desktop adapter uses deterministic shell/clipboard APIs and shell-free platform launchers.');
