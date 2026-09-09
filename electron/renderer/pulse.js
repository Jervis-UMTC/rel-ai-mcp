let currentModel = { route: '#home' };
let expanded = false;
let morphAnimation = null;
let morphDirection = '';
let compactSize = null;

const PULSE_TRANSITION_MS = 220;
const PULSE_EASING = 'cubic-bezier(.16,1,.3,1)';

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
  if (model?.expanded === false && expanded) resetExpandedFromHost();
  currentModel = {
    ...currentModel,
    contextTitle: '',
    workspace: '',
    otherTaskCount: 0,
    taskNames: [],
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
  const taskNames = (Array.isArray(currentModel.taskNames) ? currentModel.taskNames : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 3);
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

  tasksRow.hidden = taskNames.length < 1;
  const hiddenTaskCount = Math.max(0, taskCount - taskNames.length);
  document.getElementById('pulseTasks').textContent = `${taskNames.join(' · ')}${hiddenTaskCount ? ` · +${hiddenTaskCount} more` : ''}`;

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
  if (expanded === value) return;
  expanded = value;
  applyExpandedAccessibility(value);

  if (morphAnimation) {
    shell.dataset.collapsing = String(!value);
    if ((value && morphDirection === 'collapse') || (!value && morphDirection === 'expand')) {
      morphDirection = value ? 'expand' : 'collapse';
      morphAnimation.reverse();
    }
    return;
  }

  if (value) {
    const before = shell.getBoundingClientRect();
    compactSize = { width: before.width, height: before.height };
    Promise.resolve(window.relaiPulse?.setExpanded?.(true))
      .then(() => {
        if (!expanded) {
          Promise.resolve(window.relaiPulse?.setExpanded?.(false)).catch(() => {});
          return;
        }
        startExpandMorph();
      })
      .catch(() => {
        expanded = false;
        applyExpandedAccessibility(false);
      });
    return;
  }

  startCollapseMorph();
}

function startExpandMorph() {
  const before = compactSize || shell.getBoundingClientRect();
  applyExpandedLayout(true);
  shell.dataset.collapsing = 'false';
  const after = shell.getBoundingClientRect();
  if (prefersReducedMotion() || !canAnimateMorph(before, after)) return;
  startMorph([
    { transform: `scale(${before.width / after.width}, ${before.height / after.height})`, borderRadius: '999px' },
    { transform: 'scale(1, 1)', borderRadius: '18px' }
  ], 'expand');
}

function startCollapseMorph() {
  if (shell.dataset.expanded !== 'true') {
    applyExpandedLayout(false);
    Promise.resolve(window.relaiPulse?.setExpanded?.(false)).catch(() => {});
    return;
  }
  shell.dataset.collapsing = 'true';
  const from = shell.getBoundingClientRect();
  const target = compactSize;
  if (prefersReducedMotion() || !canAnimateMorph(target, from)) {
    finishCollapsedLayout();
    return;
  }
  startMorph([
    { transform: 'scale(1, 1)', borderRadius: '18px' },
    { transform: `scale(${target.width / from.width}, ${target.height / from.height})`, borderRadius: '999px' }
  ], 'collapse');
}

function startMorph(keyframes, direction) {
  morphAnimation?.cancel();
  morphDirection = direction;
  const animation = shell.animate(keyframes, {
    duration: PULSE_TRANSITION_MS,
    easing: PULSE_EASING,
    fill: 'both'
  });
  morphAnimation = animation;
  animation.addEventListener('finish', () => finishMorph(animation), { once: true });
  animation.addEventListener('cancel', () => {
    if (morphAnimation === animation) {
      morphAnimation = null;
      morphDirection = '';
    }
  }, { once: true });
}

function finishMorph(animation) {
  if (morphAnimation !== animation) return;
  const direction = morphDirection;
  morphAnimation = null;
  morphDirection = '';
  if (direction === 'collapse' && !expanded) {
    applyExpandedLayout(false);
    animation.cancel();
    finishCollapsedLayout();
    return;
  }
  animation.cancel();
  shell.dataset.collapsing = 'false';
  if (!expanded) startCollapseMorph();
}

function finishCollapsedLayout() {
  applyExpandedLayout(false);
  shell.dataset.collapsing = 'false';
  Promise.resolve(window.relaiPulse?.setExpanded?.(false)).catch(() => {});
}

function resetExpandedFromHost() {
  const animation = morphAnimation;
  morphAnimation = null;
  morphDirection = '';
  animation?.cancel();
  expanded = false;
  applyExpandedAccessibility(false);
  applyExpandedLayout(false);
  shell.dataset.collapsing = 'false';
}

function applyExpandedAccessibility(value) {
  toggle.setAttribute('aria-expanded', String(value));
  toggle.setAttribute('aria-label', value ? 'Hide activity details' : 'Show activity details');
  island.setAttribute('aria-hidden', String(!value));
  openButton.tabIndex = value ? 0 : -1;
}

function applyExpandedLayout(value) {
  shell.dataset.expanded = String(value);
}

function canAnimateMorph(compact, expandedRect) {
  return Boolean(compact && expandedRect
    && compact.width > 0 && compact.height > 0
    && expandedRect.width > 0 && expandedRect.height > 0
    && typeof shell.animate === 'function');
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

document.querySelector('.pulse-bar')?.addEventListener('click', event => {
  if (!expanded && !event.target.closest('button')) setExpanded(true);
});
toggle.addEventListener('click', event => {
  event.stopPropagation();
  setExpanded(!expanded);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && expanded) setExpanded(false);
});
openButton.addEventListener('click', () => {
  Promise.resolve(window.relaiPulse?.openDashboard?.()).catch(() => {});
});
window.relaiPulse?.onState?.(updatePulse);
