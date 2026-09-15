import { localWindowWebPreferences, secureLocalWindow } from './window-security.js';
import { projectPulseStatus } from './pulse-state.js';

const PULSE_WIDTH = 286;
const PULSE_HEIGHT = 48;
const PULSE_EXPANDED_WIDTH = 364;
const PULSE_EXPANDED_HEIGHT = 384;
const PULSE_MARGIN = 18;
const PULSE_UNLINKED_SHOW_DELAY_MS = 300;

function createPulseWindowManager(options = {}) {
  const {
    BrowserWindow,
    screen,
    iconPath = '',
    preloadPath,
    rendererUrl,
    installProtocol = () => {},
    platform = process.platform,
    env = process.env,
    isQuitting = () => false,
    onSecurityError = () => {}
  } = options;
  if (!BrowserWindow) throw new TypeError('Pulse requires Electron BrowserWindow.');
  if (!screen) throw new TypeError('Pulse requires Electron screen.');

  let window = null;
  let rendererReady = false;
  let enabled = true;
  let started = false;
  let themePreference = 'system';
  let expanded = false;
  let customAnchor = null;
  let applyingGeometry = false;
  let geometryRevision = 0;
  let pendingShowTimer = null;
  let currentStatus = {};
  let currentModel = projectPulseStatus(currentStatus);
  const wayland = platform === 'linux' && String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland';

  function start() {
    if (started) return false;
    // Electron's screen proxy cannot be inspected until app.whenReady().
    if (typeof screen.getPrimaryDisplay !== 'function') throw new TypeError('Pulse requires Electron screen.');
    started = true;
    screen.on?.('display-added', reposition);
    screen.on?.('display-removed', reposition);
    screen.on?.('display-metrics-changed', reposition);
    sync();
    return true;
  }

  function setEnabled(value) {
    enabled = value !== false;
    sync();
    return enabled;
  }

  function update(status = {}) {
    currentStatus = status && typeof status === 'object' ? status : {};
    currentModel = projectPulseStatus(currentStatus);
    sync();
    return pulseModel();
  }

  function setThemePreference(value) {
    themePreference = ['dark', 'light'].includes(value) ? value : 'system';
    sync();
    return themePreference;
  }

  function setExpanded(value) {
    const next = value === true;
    if (expanded === next) return expanded;
    expanded = next;
    applyGeometry();
    return expanded;
  }

  function pulseModel() {
    return { ...currentModel, themePreference, expanded };
  }

  function sync() {
    if (!started || !enabled || !currentModel.visible || isQuitting()) {
      hide();
      return;
    }
    if (shouldDelayUnlinkedShow()) {
      scheduleUnlinkedShow();
      return;
    }
    cancelPendingShow();
    showCurrentModel();
  }

  function shouldDelayUnlinkedShow() {
    const visible = window && !window.isDestroyed() && window.isVisible();
    return !visible && isUnlinkedWorkingActivity(currentStatus, currentModel);
  }

  function scheduleUnlinkedShow() {
    if (pendingShowTimer !== null) return;
    pendingShowTimer = setTimeout(() => {
      pendingShowTimer = null;
      if (!started || !enabled || !currentModel.visible || isQuitting()) return;
      if (!isUnlinkedWorkingActivity(currentStatus, currentModel)) {
        sync();
        return;
      }
      showCurrentModel();
    }, PULSE_UNLINKED_SHOW_DELAY_MS);
    pendingShowTimer.unref?.();
  }

  function cancelPendingShow() {
    if (pendingShowTimer === null) return;
    clearTimeout(pendingShowTimer);
    pendingShowTimer = null;
  }

  function showCurrentModel() {
    const win = getOrCreateWindow();
    if (rendererReady) win.webContents.send('pulse:update', pulseModel());
    if (!win.isVisible()) {
      if (typeof win.showInactive === 'function') win.showInactive();
      else win.show();
    }
  }

  function getOrCreateWindow() {
    if (window && !window.isDestroyed()) return window;
    const bounds = pulseBounds(screen, { expanded: false });
    window = new BrowserWindow({
      ...bounds,
      width: PULSE_WIDTH,
      height: PULSE_HEIGHT,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: !wayland,
      autoHideMenuBar: true,
      title: 'Rel.AI Pulse',
      icon: iconPath || undefined,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: localWindowWebPreferences(preloadPath, 'relai-pulse', 'pulse')
    });
    installProtocol(window.webContents.session.protocol);
    secureLocalWindow(window, { allowedUrl: rendererUrl, onError: onSecurityError });
    void Promise.resolve(window.loadURL(rendererUrl)).catch(error => {
      onSecurityError(new Error(`Pulse renderer failed to load: ${error instanceof Error ? error.message : String(error)}`));
    });
    window.webContents.on('did-finish-load', () => {
      rendererReady = true;
      window?.webContents.send('pulse:update', pulseModel());
    });
    window.on('close', event => {
      if (isQuitting()) return;
      event.preventDefault();
      window?.hide();
    });
    if (platform === 'win32' || platform === 'darwin') window.on('will-move', rememberManualPosition);
    else if (!wayland) window.on('move', rememberPosition);
    window.on('closed', () => {
      window = null;
      rendererReady = false;
    });
    return window;
  }

  function reposition() {
    if (wayland) return;
    applyGeometry();
  }

  function applyGeometry() {
    if (!window || window.isDestroyed()) return;
    const bounds = pulseBounds(screen, { expanded, anchor: customAnchor });
    if (wayland) {
      window.setSize?.(bounds.width, bounds.height, false);
      return;
    }
    if (typeof window.getBounds === 'function' && sameBounds(window.getBounds(), bounds)) return;
    const revision = ++geometryRevision;
    applyingGeometry = true;
    window.setBounds?.(bounds, false);
    setImmediate(() => {
      if (geometryRevision === revision) applyingGeometry = false;
    });
  }

  function rememberManualPosition(_event, newBounds) {
    if (wayland || !newBounds) return;
    rememberAnchor(newBounds);
  }

  function rememberPosition() {
    if (wayland || applyingGeometry || !window || window.isDestroyed() || typeof window.getBounds !== 'function') return;
    rememberAnchor(window.getBounds());
  }

  function rememberAnchor(bounds) {
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width)) return;
    customAnchor = { right: bounds.x + bounds.width, top: bounds.y };
  }

  function hide() {
    cancelPendingShow();
    const wasExpanded = expanded;
    expanded = false;
    if (wasExpanded) applyGeometry();
    if (window && !window.isDestroyed() && window.isVisible()) window.hide();
  }

  function stop() {
    if (!started) return false;
    started = false;
    screen.off?.('display-added', reposition);
    screen.off?.('display-removed', reposition);
    screen.off?.('display-metrics-changed', reposition);
    geometryRevision += 1;
    applyingGeometry = false;
    cancelPendingShow();
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
    rendererReady = false;
    return true;
  }

  function getWindow() {
    return window && !window.isDestroyed() ? window : null;
  }

  return { start, stop, update, setEnabled, setThemePreference, setExpanded, getWindow };
}

function pulseBounds(screen, options = {}) {
  const expanded = options.expanded === true;
  const width = expanded ? PULSE_EXPANDED_WIDTH : PULSE_WIDTH;
  const height = expanded ? PULSE_EXPANDED_HEIGHT : PULSE_HEIGHT;
  const anchor = options.anchor && Number.isFinite(options.anchor.right) && Number.isFinite(options.anchor.top)
    ? options.anchor
    : null;
  const display = anchor && typeof screen.getDisplayNearestPoint === 'function'
    ? screen.getDisplayNearestPoint({ x: anchor.right - 1, y: anchor.top })
    : screen.getPrimaryDisplay();
  const workArea = display?.workArea || { x: 0, y: 0, width: width + (PULSE_MARGIN * 2), height: height + (PULSE_MARGIN * 2) };
  if (anchor) {
    return {
      x: Math.round(clamp(anchor.right - width, workArea.x, workArea.x + workArea.width - width)),
      y: Math.round(clamp(anchor.top, workArea.y, workArea.y + workArea.height - height)),
      width,
      height
    };
  }
  return {
    x: Math.round(workArea.x + Math.max(PULSE_MARGIN, workArea.width - width - PULSE_MARGIN)),
    y: Math.round(workArea.y + PULSE_MARGIN),
    width,
    height
  };
}

function isUnlinkedWorkingActivity(status = {}, model = {}) {
  const activity = status?.taskActivity && typeof status.taskActivity === 'object' ? status.taskActivity : {};
  const activeCalls = Math.max(0, Number(activity.activeCalls || 0));
  const activeTaskCount = Math.max(0, Number(activity.activeTaskCount || 0));
  const tasks = Array.isArray(activity.tasks) ? activity.tasks.filter(task => task && typeof task === 'object') : [];
  return model?.tone === 'working' && activeCalls > 0 && activeTaskCount === 0 && tasks.length === 0;
}

function sameBounds(left, right) {
  return left?.x === right?.x
    && left?.y === right?.y
    && left?.width === right?.width
    && left?.height === right?.height;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export { PULSE_EXPANDED_HEIGHT, PULSE_EXPANDED_WIDTH, PULSE_HEIGHT, PULSE_UNLINKED_SHOW_DELAY_MS, PULSE_WIDTH, createPulseWindowManager, pulseBounds };
