function registerCodeWorkspaceIpc({
  ipc,
  channels,
  getTaskCodeWorkspace,
  readTaskCodeDiff,
  listCodeEditors,
  openTaskCodeIde
}) {
  ipc.handle(channels.DESKTOP_CODE_GET, 'Code workspace', (_event, payload) => getTaskCodeWorkspace(normalizeTaskPayload(payload)));
  ipc.handle(channels.DESKTOP_CODE_DIFF, 'Code diff', (_event, payload) => readTaskCodeDiff(normalizeFilePayload(payload)));
  ipc.handle(channels.DESKTOP_CODE_EDITORS, 'Code editors', () => listCodeEditors());
  ipc.handle(channels.DESKTOP_CODE_OPEN_IDE, 'Code editor launch', (_event, payload) => openTaskCodeIde(normalizeIdePayload(payload)));
}

function normalizeTaskPayload(payload = {}) {
  return { taskId: boundedText(payload?.taskId, 'taskId', 200) };
}

function normalizeFilePayload(payload = {}) {
  return {
    ...normalizeTaskPayload(payload),
    path: boundedText(payload?.path, 'path', 512)
  };
}

function normalizeIdePayload(payload = {}) {
  return {
    ...normalizeTaskPayload(payload),
    editorId: boundedText(payload?.editorId, 'editorId', 40)
  };
}

function boundedText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  if (text.includes('\u0000')) throw new Error(`${label} contains an invalid character.`);
  return text;
}

export { registerCodeWorkspaceIpc };
