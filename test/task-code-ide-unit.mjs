import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTaskCodeIdeLauncher, detectEditors } from '../electron/task-code-ide.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-code-ide-'));
const local = path.join(root, 'local');
const programFiles = path.join(root, 'program-files');
const code = path.join(programFiles, 'Microsoft VS Code', 'Code.exe');
const cursor = path.join(local, 'Programs', 'Cursor', 'Cursor.exe');
fs.mkdirSync(path.dirname(code), { recursive: true });
fs.mkdirSync(path.dirname(cursor), { recursive: true });
fs.writeFileSync(code, 'fixture');
fs.writeFileSync(cursor, 'fixture');

try {
  const editors = detectEditors({
    platform: 'win32',
    env: { LOCALAPPDATA: local, ProgramFiles: programFiles }
  });
  assert.deepEqual(editors.map(editor => editor.id), ['vscode', 'cursor']);
  assert.equal(editors.find(editor => editor.id === 'vscode')?.executable, code, 'IDE detection must continue to the Program Files candidate when the LocalAppData candidate is absent');
  assert.equal(new Set(editors.map(editor => editor.id)).size, editors.length, 'IDE detection must not return duplicate editor IDs');

  const launcher = createTaskCodeIdeLauncher({
    shell: { openPath: async () => '' },
    platform: 'win32',
    env: { LOCALAPPDATA: local, ProgramFiles: programFiles }
  });
  fs.rmSync(code);
  await assert.rejects(
    () => launcher.open(root, 'vscode'),
    /ENOENT|spawn/i,
    'IDE launch must reject when the detected executable disappears before spawn'
  );

  console.log('Task code IDE detection and launch failure propagation passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
