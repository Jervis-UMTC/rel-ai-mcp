function registerAnalyticsIpc({ ipc, channels, getLocalUsage }) {
  ipc.handle(channels.DESKTOP_ANALYTICS_LOCAL, 'Local analytics', (_event, month) => getLocalUsage(normalizeAnalyticsMonth(month)));
}

function registerDesktopSettingsIpc({
  ipc,
  channels,
  getDesktopSettings,
  saveDesktopSettings,
  getLifecycleStatus,
  setLaunchAtLogin,
  setKeepAwake,
  setAppPreferences,
  getNotificationsEnabled,
  setNotificationsEnabled,
  getNotificationPreferences,
  updateNotificationPreferences
}) {
  ipc.handle(channels.DESKTOP_SETTINGS_GET, 'Desktop settings', () => getDesktopSettings());
  ipc.handle(channels.DESKTOP_SETTINGS_SAVE, 'Desktop settings', (_event, settings) => saveDesktopSettings(settings));
  ipc.handle(channels.DESKTOP_LIFECYCLE_GET, 'Desktop lifecycle', () => getLifecycleStatus());
  ipc.handle(channels.DESKTOP_STARTUP_SET, 'Launch at login', (_event, enabled) => setLaunchAtLogin(enabled));
  ipc.handle(channels.DESKTOP_KEEP_AWAKE_SET, 'Keep awake', (_event, enabled) => setKeepAwake(enabled));
  ipc.handle(channels.DESKTOP_APP_PREFERENCES_SET, 'App preferences', (_event, patch) => setAppPreferences(patch));
  ipc.handle(channels.DESKTOP_NOTIFICATIONS_GET, 'Desktop notifications', () => ({ ok: true, enabled: getNotificationsEnabled() }));
  ipc.handle(channels.DESKTOP_NOTIFICATIONS_SET, 'Desktop notifications', (_event, enabled) => ({ ok: true, enabled: setNotificationsEnabled(enabled) }));
  ipc.handle(channels.DESKTOP_NOTIFICATION_PREFERENCES_GET, 'Notification preferences', () => ({ ok: true, preferences: getNotificationPreferences() }));
  ipc.handle(channels.DESKTOP_NOTIFICATION_PREFERENCES_SET, 'Notification preferences', (_event, patch) => updateNotificationPreferences(patch));
}

function registerUpdaterIpc({ ipc, channels, getUpdateStatus, checkForUpdates, downloadUpdate, installUpdate }) {
  ipc.handle(channels.DESKTOP_UPDATE_GET, 'Update status', () => getUpdateStatus());
  ipc.handle(channels.DESKTOP_UPDATE_CHECK, 'Update check', () => checkForUpdates());
  ipc.handle(channels.DESKTOP_UPDATE_DOWNLOAD, 'Update download', () => downloadUpdate());
  ipc.handle(channels.DESKTOP_UPDATE_INSTALL, 'Update install', () => installUpdate());
}

function registerDiagnosticsIpc({ ipc, channels, exportDiagnosticState, openDiagnosticsFolder }) {
  ipc.handle(channels.DESKTOP_DIAGNOSTICS_EXPORT, 'Diagnostic export', (_event, report) => exportDiagnosticState(report));
  ipc.handle(channels.DESKTOP_DIAGNOSTICS_OPEN_FOLDER, 'Diagnostics folder', () => openDiagnosticsFolder());
}

function registerLocalDataIpc({ ipc, channels, getLocalDataUsage, clearTemporaryLocalData, openLocalDataFolder }) {
  ipc.handle(channels.DESKTOP_LOCAL_DATA_GET, 'Local data', () => getLocalDataUsage());
  ipc.handle(channels.DESKTOP_LOCAL_DATA_CLEAR_TEMPORARY, 'Local data cleanup', () => clearTemporaryLocalData());
  ipc.handle(channels.DESKTOP_LOCAL_DATA_OPEN_FOLDER, 'Local data folder', () => openLocalDataFolder());
}

function normalizeAnalyticsMonth(month) {
  const value = String(month || '').trim();
  if (value && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Analytics month must use YYYY-MM.');
  return value;
}

export { registerAnalyticsIpc, registerDesktopSettingsIpc, registerDiagnosticsIpc, registerLocalDataIpc, registerUpdaterIpc };
