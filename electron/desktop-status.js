import { importResourceModule } from './resource-path.js';

const { deriveConnectionState } = await importResourceModule('src/desktopUxContracts.js');
const { createEmptyTaskActivity } = await importResourceModule('src/contracts/tasks.ts');

function initialDesktopStatus(version = '') {
  return normalizeDesktopStatus({
    serverRunning: false,
    tunnelStatus: 'stopped',
    tunnelId: '',
    tunnelHealthUrl: '',
    mcpUrl: '',
    localMcpUrl: '',
    error: '',
    errorCode: '',
    localUrl: '',
    version,
    taskActivity: createEmptyTaskActivity()
  });
}

function normalizeDesktopStatus(status = {}) {
  return { ...status, connectionState: deriveConnectionState(status) };
}

function desktopStatusFailure(errorCode, error, next = {}) {
  return { ...next, error: formatDesktopError(error), errorCode };
}

function formatDesktopError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export { desktopStatusFailure, initialDesktopStatus, normalizeDesktopStatus };
