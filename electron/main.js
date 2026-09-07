import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Tray,
  Menu,
  clipboard,
  shell,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  Notification,
  dialog,
  screen,
  protocol,
  session,
  safeStorage,
  utilityProcess
} from 'electron';
import electronUpdater from 'electron-updater';

import { createDesktopHost } from './desktop-host.js';
import { normalizeWizardConfig, saveLauncherConfig } from './launcher-config.js';

const { autoUpdater } = electronUpdater;
const desktop = await createDesktopHost({
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Tray,
  Menu,
  clipboard,
  shell,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  Notification,
  dialog,
  screen,
  protocol,
  session,
  safeStorage,
  utilityProcess,
  autoUpdater,
  saveLauncherConfig
});

// Electron waits for ESM evaluation before emitting ready. Do not await a
// startup promise that itself waits for app.whenReady() at module scope.
void desktop.start().catch(error => {
  console.error('[rel-ai-mcp] Desktop startup failed:', error);
  app.exit(1);
});

export { normalizeWizardConfig, saveLauncherConfig };
