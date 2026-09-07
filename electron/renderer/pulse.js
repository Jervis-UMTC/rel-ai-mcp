let currentModel = { route: '#home' };
let expanded = false;
let collapseTimer = null;
let geometryTimer = null;

const PULSE_TRANSITION_MS = 170;

const shell = document.getElementById('pulseShell');
const toggle = document.getElementById('pulseToggle');
const island = document.getElementById('pulseIsland');
const openButton = document.getElementById('pulseOpen');
const workspaceRow = document.getElementById('pulseWorkspaceRow');
const tasksRow = document.getElementById('pulseTasksRow');
const progress = document.getElementById('pulseProgress');

function stateLabel(model) {
  if (model.actionRequired) return 'Action required';
  if (model.tone === 'working') return 'Working';
  if (model.tone === 'waiting') return 'Open';
  if (model.tone === 'attention') return 'Needs attention';
  return 'Rel.AI';
}

function updatePulse(model = {}) {
  currentModel = {
    ...currentModel,
    contextTitle: '',
    workspace: '',
    otherTaskCount: 0,
    progressPercent: undefined,
    progressLabel: '',
    ...(model || {})
  };
  const themePreference = ['dark', 'light'].includes(currentModel.themePreference) ? currentModel.themePreference : '';
  if (themePreference) document.documentElement.dataset.theme = themePreference;
  else delete document.documentElement.dataset.theme;

  const label = stateLabel(currentModel);
  const title = currentModel.title || 'Rel.AI';
  const contextTitle = String(currentModel.contextTitle || '').trim();
  const detail = String(currentModel.detail || '').trim();
  const workspace = String(currentModel.workspace || '').trim();
  const taskCount = Math.max(0, Number(currentModel.taskCount || 0));
  const otherTaskCount = Math.max(0, Number(currentModel.otherTaskCount || 0));
  const progressPercent = Number(currentModel.progressPercent);
  const hasProgress = Number.isFinite(progressPercent) && progressPercent >= 0;

  shell.dataset.tone = String(currentModel.tone || 'idle');
  document.getElementById('pulseState').textContent = label;
  document.getElementById('pulseExpandedState').textContent = label;
  const taskCountElement = document.getElementById('pulseTaskCount');
  taskCountElement.hidden = taskCount < 1;
  taskCountElement.textContent = taskCount === 1 ? '1 task' : `${taskCount} tasks`;
  document.getElementById('pulseCompactTitle').textContent = title;
  document.getElementById('pulseTitle').textContent = title;
  document.getElementById('pulseSummary').textContent = contextTitle && contextTitle !== title ? contextTitle : (detail || 'Local activity is in progress.');

  workspaceRow.hidden = !workspace;
  document.getElementById('pulseWorkspace').textContent = workspace;

  tasksRow.hidden = otherTaskCount < 1;
  document.getElementById('pulseTasks').textContent = otherTaskCount === 1 ? '1 other local task' : `${otherTaskCount} other local tasks`;

  progress.hidden = !hasProgress;
  if (hasProgress) {
    const percent = Math.min(100, Math.max(0, progressPercent));
    document.getElementById('pulseProgressFill').style.width = `${percent}%`;
    document.getElementById('pulseProgressLabel').textContent = currentModel.progressLabel || 'Progress';
    document.getElementById('pulseProgressValue').textContent = `${Math.round(percent)}%`;
  }

  document.getElementById('pulseOpenLabel').textContent = currentModel.actionRequired ? 'Review in Rel.AI' : 'Open in Rel.AI';
  openButton.setAttribute('aria-label', `${currentModel.actionRequired ? 'Review' : 'Open'} ${title}`);
}

function setExpanded(next) {
  const value = next === true;
  clearTimeout(collapseTimer);
  collapseTimer = null;
  clearTimeout(geometryTimer);
  geometryTimer = null;
  if (expanded === value) return;
  expanded = value;

  if (value) {
    Promise.resolve(window.relaiPulse?.setExpanded?.(true))
      .catch(() => {})
      .finally(() => {
        if (!expanded) return;
        requestAnimationFrame(() => {
          if (expanded) applyExpandedVisual(true);
        });
      });
    return;
  }

  applyExpandedVisual(false);
  geometryTimer = setTimeout(() => {
    if (!expanded) Promise.resolve(window.relaiPulse?.setExpanded?.(false)).catch(() => {});
  }, PULSE_TRANSITION_MS);
}

function applyExpandedVisual(value) {
  shell.dataset.expanded = String(value);
  toggle.setAttribute('aria-expanded', String(value));
  toggle.setAttribute('aria-label', value ? 'Hide activity details' : 'Show activity details');
  island.setAttribute('aria-hidden', String(!value));
  openButton.tabIndex = value ? 0 : -1;
}

function scheduleCollapse() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    if (!shell.matches(':hover') && !shell.contains(document.activeElement)) setExpanded(false);
  }, 260);
}

shell.addEventListener('pointerenter', () => setExpanded(true));
shell.addEventListener('pointerleave', scheduleCollapse);
shell.addEventListener('focusin', () => setExpanded(true));
shell.addEventListener('focusout', scheduleCollapse);
toggle.addEventListener('click', event => {
  event.stopPropagation();
  setExpanded(!expanded);
});
openButton.addEventListener('click', () => {
  Promise.resolve(window.relaiPulse?.openDashboard?.(currentModel.route || '#home')).catch(() => {});
});
window.relaiPulse?.onState?.(updatePulse);
