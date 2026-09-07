import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MAX_DESKTOP_CLIPBOARD_BYTES,
  configureDesktopNativeBridge,
  runDesktopAction
} from '../src/desktopManager.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-desktop-manager-'));
const outside = path.join(path.dirname(root), `outside-${path.basename(root)}.txt`);
const proposal = path.join(root, 'proposal.docx');
const secret = path.join(root, '.env');
fs.writeFileSync(proposal, 'proposal');
fs.writeFileSync(secret, 'API_KEY=secret-value');
fs.writeFileSync(outside, 'outside');

const workspace = { alias: 'fixture', path: root };
const enabledConfig = { computerControl: { enabled: true } };
const calls = [];
let clipboardReadText = 'clipboard value';
configureDesktopNativeBridge(async payload => {
  calls.push(payload);
  if (payload.action === 'clipboard_read') return { ok: true, platform: 'win32', text: clipboardReadText };
  if (payload.action === 'launch_application' && payload.application === 'missing-app') {
    throw new Error("Application 'missing-app' could not be launched.");
  }
  return { ok: true, platform: 'win32' };
});

try {
  const callsBeforeDisabled = calls.length;
  await assert.rejects(
    () => runDesktopAction(workspace, {}, { action: 'clipboard_read' }),
    error => error?.code === 'COMPUTER_CONTROL_DISABLED'
  );
  assert.equal(calls.length, callsBeforeDisabled, 'disabled Computer Control must block structured desktop access before the native bridge');

  const opened = await runDesktopAction(workspace, enabledConfig, { action: 'open_path', path: 'proposal.docx' });
  assert.deepEqual(opened, {
    ok: true,
    workspace: 'fixture',
    action: 'open_path',
    platform: 'win32',
    path: 'proposal.docx',
    kind: 'file'
  });
  assert.equal(calls.at(-1).path, proposal);

  const revealed = await runDesktopAction(workspace, enabledConfig, { action: 'reveal_path', path: 'proposal.docx' });
  assert.equal(revealed.path, 'proposal.docx');
  assert.equal(calls.at(-1).action, 'reveal_path');

  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'open_path', path: `../${path.basename(outside)}` }),
    /traversal|escapes workspace/i
  );
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'open_path', path: '.env' }),
    /blocked sensitive path/i
  );
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'open_path', path: 'missing.docx' }),
    /does not exist/i
  );

  const uri = await runDesktopAction(workspace, enabledConfig, { action: 'open_uri', uri: 'https://example.com/docs' });
  assert.equal(uri.uri, 'https://example.com/docs');
  assert.deepEqual(calls.at(-1), { action: 'open_uri', uri: 'https://example.com/docs' });
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'open_uri', uri: 'not a uri' }),
    /absolute valid URI/i
  );
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'open_uri', uri: 'file:///tmp/secret.txt' }),
    /protocol is not allowed/i
  );

  const launched = await runDesktopAction(workspace, enabledConfig, { action: 'launch_application', application: 'notepad.exe' });
  assert.equal(launched.application, 'notepad.exe');
  assert.deepEqual(calls.at(-1), { action: 'launch_application', application: 'notepad.exe' });
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'launch_application', application: '../notepad.exe' }),
    /not a path or command/i
  );
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'launch_application', application: 'missing-app' }),
    /could not be launched/i
  );

  const read = await runDesktopAction(workspace, enabledConfig, { action: 'clipboard_read' });
  assert.equal(read.text, 'clipboard value');
  assert.equal(read.textLength, 'clipboard value'.length);

  const written = await runDesktopAction(workspace, enabledConfig, { action: 'clipboard_write', text: 'a\u0000b' });
  assert.equal(written.textLength, 2);
  assert.deepEqual(calls.at(-1), { action: 'clipboard_write', text: 'ab' });
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'clipboard_write', text: 'x'.repeat(MAX_DESKTOP_CLIPBOARD_BYTES + 1) }),
    /64 KiB/i
  );
  clipboardReadText = 'x'.repeat(MAX_DESKTOP_CLIPBOARD_BYTES + 1);
  await assert.rejects(() => runDesktopAction(workspace, enabledConfig, { action: 'clipboard_read' }), /64 KiB/i);
  clipboardReadText = 'clipboard value';

  const controller = new AbortController();
  controller.abort();
  const callsBeforeCancellation = calls.length;
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'clipboard_read' }, { signal: controller.signal }),
    error => error?.name === 'AbortError'
  );
  assert.equal(calls.length, callsBeforeCancellation, 'pre-cancelled structured actions must not reach the native bridge');

  configureDesktopNativeBridge(null);
  await assert.rejects(
    () => runDesktopAction(workspace, enabledConfig, { action: 'clipboard_read' }),
    /desktop launcher/i
  );
} finally {
  configureDesktopNativeBridge(null);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { force: true });
}

console.log('Structured desktop manager preserves Computer Control permission and enforces workspace paths, bounded clipboard data, URI/app validation, native routing, and cancellation.');
