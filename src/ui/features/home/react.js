import React, { useEffect, useMemo, useState } from 'react';
import { copyText } from '../../clipboard.js';
import { SparkChart } from '../../components/charts.js';
import { Icon } from '../../components/icons.js';
import { pillClass } from '../../components/pill.js';
import { taskProgressView } from '../../components/task-progress.js';
import { toast } from '../../components/toast.js';
import { routeMetadata } from '../../navigation-catalog.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';
import { statusTone } from '../../status-tone.js';
import { workSessionStateView } from '../../task-identity.js';
import { classifyTaskActivity } from '../../../taskActivityPresentation.js';
import { formatDuration, timeAgo } from '../../utils.js';
import { buildTaskSemanticProgress } from '../../../taskSemanticProgress.js';
import { completeDesktopSetup, desktopSetupSteps, dismissDesktopSetup, isDesktopSetupDismissed } from '../onboarding/index.js';
import { CHATGPT_CONNECTOR_CREATE_URL, RELAI_CONNECTOR_ICON_FILENAME, RELAI_CONNECTOR_ICON_URL, chatGptFirstPrompt, chatGptGuideSteps } from '../settings/connection-guidance.js';
import { loadAnalyticsData } from '../usage/data.js';
import { desktopSetupState, homeAnalyticsView, overviewState, overviewWorkspaceStatus } from './index.js';

const h = React.createElement;
const HOME_STORE_KEYS = Object.freeze(['config', 'health', 'connection', 'connectionState', 'desktopStatus', 'mcpConnection', 'tasks', 'taskActivity', 'live']);

export function createHomeRoute(useDashboardSlices) {
  return function HomeRoute() {
    return h(HomeView, { data: useDashboardSlices(HOME_STORE_KEYS) });
  };
}

function HomeView({ data = {} }) {
  const workspace = getWorkspaceFilter();
  const state = useMemo(() => overviewState(data, workspace), [data, workspace]);
  const setup = useMemo(() => desktopSetupState(data), [data]);
  const activeCard = taskActivityModel(data.taskActivity, state.tasks[0]);
  return h('div', { className: 'section', 'data-home-react': '' },
    activeCard ? h(TaskActivityCard, { model: activeCard }) : null,
    h(DesktopSetupChecklist, { setup }),
    h(ConnectionHero, { state: state.bridgeState }),
    setup.firstRequestObserved ? h(HomeAnalytics, { taskRevision: Number(data.live?.revisions?.task || 0), workspace }) : null,
    h('div', { className: 'layout-grid' },
      h(WorkspaceSummaryCard, { workspaces: state.workspaces, findings: state.findings }),
      setup.firstRequestObserved ? h(RecentTasksCard, { tasks: state.tasks }) : null
    )
  );
}

function ConnectionHero({ state }) {
  return h('section', { className: `overview-hero overview-hero-compact ${state.tone}`, 'data-home-live-connection': '' },
    h('div', { className: 'overview-copy' },
      h('div', { className: 'overview-kicker' }, state.kicker),
      h('h2', { className: 'overview-title' }, state.title),
      h('p', { className: 'overview-description' }, state.description)
    ),
    h('a', { className: 'buttonlike secondary compact-button', href: routeMetadata('settings/connection').href }, 'View connection')
  );
}

function TaskActivityCard({ model }) {
  const task = model.task;
  if (model.active) {
    const startedAt = task.startedAtIso || task.createdAt || task.startedAt || '';
    const startedAtMs = Date.parse(startedAt) || Number(task.startedAt || Date.now());
    const stateClass = model.attention ? 'attention' : model.waiting ? 'waiting' : 'active';
    return h('section', { className: `card task-overview ${stateClass}`, 'data-home-live-activity': '' },
      h('div', { className: 'task-overview-mark', 'aria-hidden': 'true' }, model.attention ? '!' : model.waiting ? '…' : h('span', { className: 'task-overview-spinner' })),
      h('div', { className: 'task-overview-copy' },
        h('div', { className: 'overview-kicker' }, 'Current task'),
        h('h3', null, model.title),
        h('p', null, model.description),
        h(TaskProgress, { progress: task.progress, status: task.status, compact: true })
      ),
      h('div', { className: 'task-overview-meta' },
        h('span', null, model.activityLabel),
        h('strong', { 'data-clock-elapsed-start': startedAt }, formatDuration(Date.now() - startedAtMs, { live: true }))
      )
    );
  }
  return h('section', { className: `card task-overview ${model.tone}`, 'data-home-live-activity': '' },
    h('div', { className: 'task-overview-mark', 'aria-hidden': 'true' }, model.mark),
    h('div', { className: 'task-overview-copy' },
      h('div', { className: 'overview-kicker' }, 'Previous task'),
      h('h3', null, task.title || model.title),
      h('p', null, model.description),
      h(TaskProgress, { progress: task.progress, status: task.status, compact: true })
    ),
    h('div', { className: 'task-overview-meta' },
      h('span', { 'data-clock-relative': task.endedAt || task.completedAt || '' }, timeAgo(task.endedAt || task.completedAt)),
      h('strong', null, formatDuration(task.durationMs))
    )
  );
}

function taskActivityModel(activity = {}, persistedTask = null) {
  const presentation = classifyTaskActivity(activity);
  const activeTasks = presentation.tasks;
  const active = presentation.category !== 'idle';
  const completedWithWarnings = persistedTask?.status === 'completed' && Number(persistedTask?.failedToolCallCount ?? persistedTask?.failures ?? 0) > 0;
  if (!active && !['failed', 'blocked', 'validation_failed'].includes(persistedTask?.status) && !completedWithWarnings) return null;
  const task = active ? presentation.primaryTask || primaryActiveTask(activeTasks) : persistedTask || activity.lastTask;
  if (!task) return null;
  if (active) {
    const activeCalls = presentation.activeCalls;
    const attention = presentation.category === 'attention';
    const waiting = presentation.category === 'waiting';
    const semantic = semanticProgressFor(task);
    const operation = semantic.currentActivity || task.currentActivity || task.operation || taskAction(task.lastTool || task.tool);
    const stage = String(semantic.currentStage || 'Task progress').trim();
    const activityText = String(semantic.currentActivity || '').trim();
    const location = task.workspace || activeTaskLocation(activeTasks);
    let title = task.title || operation || 'Current task';
    let description = activityText && activityText !== stage ? `${stage} · ${activityText}` : stage || activityText || 'Task is open';
    description = location ? `${description} in ${location}.` : `${description}.`;
    if (!task.title && !attention && !waiting && activeTasks.length > 1) title = `${activeCalls} Rel.AI actions are running.`;
    if (!attention && !waiting && activeTasks.length > 1) description = `${activeCalls} ${pluralLabel(activeCalls, 'active action')} across ${activeTaskLocation(activeTasks)}.`;
    return {
      active: true,
      attention,
      waiting,
      task,
      title,
      description,
      stage,
      activity: activityText,
      location,
      activityLabel: attention
        ? `Action required · ${statusLabel(task.status)}`
        : waiting
          ? `${statusLabel(task.status)} · latest progress`
          : `${activeCalls} ${pluralLabel(activeCalls, 'active call')}`
    };
  }
  const attention = ['failed', 'blocked', 'validation_failed'].includes(task.status);
  const completed = task.status === 'completed' && task.completionKnown === true;
  const failed = Number(task.failures || 0);
  const callCount = Number(task.calls || 0);
  let mark = '•';
  let title = 'Last task is inactive';
  if (attention) {
    mark = '!';
    title = task.status === 'blocked' ? 'Last task was blocked' : task.status === 'validation_failed' ? 'Last task needs attention' : 'Last task failed';
  } else if (completed) {
    mark = '✓';
    title = 'Task completed';
  }
  const failureText = failed ? completed ? ` · ${failed} warning${failed === 1 ? '' : 's'}` : ` · ${failed} failed` : '';
  const completionText = completed ? ` · ${task.summary || 'final checks passed'}` : ' · ChatGPT did not report a final result';
  return { active: false, task, mark, title, tone: attention ? 'attention' : completed ? 'completed' : 'waiting', description: `${task.workspace || 'project'} · ${callCount} ${pluralLabel(callCount, 'action')}${failureText}${completionText}` };
}

function WorkspaceSummaryCard({ workspaces, findings }) {
  return h('section', { className: 'card', 'data-home-live-workspaces': '' },
    h('div', { className: 'card-head' }, h('h3', null, 'Projects'), h('a', { className: 'section-action', href: routeMetadata('workspaces').href }, 'Manage')),
    h('div', { className: 'card-body compact-workspace-list' },
      workspaces.length ? workspaces.slice(0, 6).map(workspace => h('div', { className: 'compact-workspace', key: workspace.alias || workspace.path },
        h('div', null, h('strong', null, workspace.alias || 'project'), h('div', { className: 'compact-workspace-path' }, workspace.path || '')),
        h(StatusPill, { value: overviewWorkspaceStatus(workspace, findings) })
      )) : h('div', { className: 'empty' }, 'No projects added yet. ', h('a', { className: 'buttonlike secondary compact-button', href: routeMetadata('workspaces').href }, 'Add your first project'))
    )
  );
}

function RecentTasksCard({ tasks }) {
  return h('section', { className: 'card', 'data-home-live-sessions': '' },
    h('div', { className: 'card-head' }, h('h3', null, 'Latest tasks'), h('a', { className: 'section-action', href: routeHref('tasks') }, 'See all tasks')),
    h('div', { className: 'card-body' },
      tasks.length ? tasks.slice(0, 5).map(task => {
        const endedAt = task.endedAt || task.completedAt;
        const warnings = task.status === 'completed' ? Number(task.failedToolCallCount ?? task.failures ?? 0) : 0;
        const warningText = warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '';
        const taskId = String(task.id || task.taskId || task.work_id || '').trim();
        return h('a', { className: 'activity-row', href: routeHref('tasks', { workspace: task.workspace || '', task: taskId }), key: taskId || `${task.workspace}-${endedAt || task.startedAt || ''}` },
          h('span', { className: 'activity-time', 'data-clock-relative': endedAt || undefined }, endedAt ? timeAgo(endedAt) : 'now'),
          h('span', { className: 'activity-name truncate' }, h('strong', null, task.title || task.operation || taskAction(task.lastTool)), ` · ${task.workspace || 'project'} · ${task.toolCallCount ?? task.calls ?? 0} actions${warningText}`),
          h(StatusPill, recentTaskStatusProps(task))
        );
      }) : h('div', { className: 'empty' }, 'Tasks will appear here after ChatGPT starts using Rel.AI on a project.')
    )
  );
}

function HomeAnalytics({ taskRevision, workspace }) {
  const [analytics, setAnalytics] = useState({ scope: null, error: false, loading: true });
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setAnalytics(current => ({ ...current, loading: !current.scope, error: false }));
      void loadAnalyticsData({ desktop: globalThis.window?.relaiDesktop, range: '24h', now: new Date(), workspace })
        .then(({ current }) => { if (active) setAnalytics({ scope: current, error: false, loading: false }); })
        .catch(() => { if (active) setAnalytics(current => ({ ...current, error: true, loading: false })); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [taskRevision, workspace]);
  if (analytics.scope) return h(HomeAnalyticsContent, { scope: analytics.scope, refreshing: analytics.loading });
  return h('section', { className: 'card home-analytics-card', 'data-home-analytics': '', 'aria-busy': analytics.loading ? 'true' : 'false' },
    h('div', { className: 'card-head home-analytics-head' },
      h('div', null, h('h3', null, 'Activity'), h('p', null, analytics.error ? 'Activity could not be loaded.' : 'Loading activity…')),
      h('a', { className: 'buttonlike secondary compact-button', href: routeHref('usage', workspace ? { workspace } : {}) }, 'View analytics')
    ),
    analytics.loading ? h('div', { className: 'home-analytics-loading', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span')) : null
  );
}

function HomeAnalyticsContent({ scope, refreshing }) {
  const view = homeAnalyticsView(scope);
  return h('section', { className: 'card home-analytics-card', 'data-home-analytics': '', 'aria-busy': refreshing ? 'true' : 'false' },
    h('div', { className: 'card-head home-analytics-head' },
      h('div', null, h('div', { className: 'home-analytics-title-row' }, h(Icon, { name: 'usage', className: 'home-analytics-title-icon', size: 17 }), h('h3', null, view.heading), h('span', null, '24h · hourly'))),
      h('a', { className: 'buttonlike secondary compact-button home-analytics-link', href: routeHref('usage', view.workspaceScoped ? { workspace: view.workspace } : {}) }, h('span', null, 'View analytics'), h(Icon, { name: 'chevronRight', size: 15 }))
    ),
    h('div', { className: 'home-analytics-body' },
      h('div', { className: 'home-analytics-metrics' }, view.metrics.map(metric => h('div', { className: 'home-analytics-metric', key: metric.label }, h('div', { className: 'home-analytics-metric-label' }, h(Icon, { name: homeAnalyticsMetricIcon(metric.label), size: 15 }), h('span', null, metric.label)), h('strong', null, metric.value), metric.detail ? h('small', null, metric.detail) : null))),
      h('div', { className: 'home-analytics-pulse' }, h('div', { className: 'home-analytics-pulse-head' }, h('div', null, h('span', null, 'Hourly activity'), h('strong', null, view.contextSummary)), h('small', null, 'UTC')), h(HomeAnalyticsPulse, { pulse: view.pulse })),
      h('div', { className: 'home-analytics-foot' }, h('span', null, view.errorSummary))
    )
  );
}

function homeAnalyticsMetricIcon(label) {
  if (label === 'Reliable actions') return 'reliability';
  if (label === 'Average time' || label === 'Total execution time') return 'timer';
  if (label === 'Active projects') return 'workspaces';
  return 'activity';
}

function HomeAnalyticsPulse({ pulse }) {
  if (pulse.empty) return h('div', { className: 'home-analytics-pulse-empty' }, 'No activity yet.');
  return h('div', { className: 'home-analytics-chart' },
    h(SparkChart, {
      values: pulse.values,
      className: 'home-analytics-chart-canvas',
      ariaLabel: pulse.summary,
      decorative: false
    }),
    h('div', { className: 'home-analytics-scale' }, h('span', null, 'Earlier'), h('span', null, 'Current hour'))
  );
}

function DesktopSetupChecklist({ setup }) {
  const [dismissed, setDismissed] = useState(() => isDesktopSetupDismissed());
  const [copyState, setCopyState] = useState('idle');
  const steps = desktopSetupSteps(setup);
  const remaining = steps.filter(item => !item.complete);
  const current = steps.find(item => !item.complete && !item.locked) || remaining[0];
  const completedCount = steps.length - remaining.length;
  useEffect(() => {
    const onState = event => setDismissed(event?.detail?.pending !== true);
    window.addEventListener('relai:onboarding-state', onState);
    return () => window.removeEventListener('relai:onboarding-state', onState);
  }, []);
  useEffect(() => { if (!remaining.length) void completeDesktopSetup(); }, [remaining.length]);
  if (!remaining.length || dismissed) return null;
  const dismiss = async () => {
    setDismissed(true);
    await dismissDesktopSetup();
    toast('Getting started guide dismissed.', { variant: 'info' });
  };
  const copyPrompt = async () => {
    try {
      await copyText(chatGptFirstPrompt(setup.workspaceAlias));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch { toast('Clipboard access failed.', { variant: 'error' }); }
  };
  return h('section', { className: 'card desktop-setup-checklist', 'data-desktop-setup-checklist': '' },
    h('div', { className: 'card-head desktop-setup-head' },
      h('div', null, h('span', { className: 'desktop-setup-eyebrow' }, 'Getting started'), h('h3', null, 'Get Rel.AI working with ChatGPT'), h('p', null, `${completedCount} of ${steps.length} steps complete. Follow the highlighted step.`)),
      h('button', { className: 'secondary compact-button', type: 'button', onClick: dismiss }, 'Dismiss guide')
    ),
    h('div', { className: 'card-body desktop-setup-items' }, steps.map((item, index) => h(DesktopSetupStep, { key: item.id, item, index, current: item.id === current?.id, setup, copyState, onCopy: copyPrompt })))
  );
}

function DesktopSetupStep({ item, index, current, setup, copyState, onCopy }) {
  const state = item.complete ? 'Done' : item.locked ? 'Not ready' : current ? 'Next' : 'Ready';
  const className = `desktop-setup-item${item.complete ? ' done' : ''}${current ? ' current' : ''}${item.locked ? ' locked' : ''}`;
  return h('div', { className },
    h('span', { className: 'desktop-setup-index', 'aria-hidden': 'true' }, item.complete ? '✓' : index + 1),
    h('div', { className: 'desktop-setup-copy' },
      h('div', { className: 'desktop-setup-title-row' }, h('strong', null, item.title), h('span', { className: 'desktop-setup-state' }, state)),
      h('p', null, item.description),
      item.id === 'first-request' && current ? h('div', { className: 'desktop-first-request' }, h('span', null, 'Paste this into ChatGPT'), h('code', null, chatGptFirstPrompt(setup.workspaceAlias))) : null,
      item.id === 'chatgpt' && current ? h(ChatGptSetupGuide, { tunnelId: setup.tunnelId }) : null
    ),
    setupAction(item, current, copyState, onCopy)
  );
}

function setupAction(item, current, copyState, onCopy) {
  if (item.complete || item.locked || item.actionType === 'guide') return null;
  if (item.actionType === 'copy') return h('button', { className: `${current ? 'primary' : 'secondary'} compact-button`, type: 'button', onClick: onCopy }, copyState === 'copied' ? 'Copied' : item.action);
  return h('a', { className: `buttonlike ${current ? 'primary' : 'secondary'} compact-button`, href: item.href }, item.action);
}

function ChatGptSetupGuide({ tunnelId }) {
  const steps = chatGptGuideSteps({ mode: 'create', tunnelId });
  const [iconSaved, setIconSaved] = useState(false);
  const saveIcon = () => {
    const link = document.createElement('a');
    link.href = RELAI_CONNECTOR_ICON_URL;
    link.download = RELAI_CONNECTOR_ICON_FILENAME;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setIconSaved(true);
  };
  return h('div', { className: 'chatgpt-setup-guide compact desktop-chatgpt-guide' },
    h('div', { className: 'chatgpt-guide-heading' }, h('strong', null, 'Finish ChatGPT setup'), h('span', null, 'Use Tunnel + No authentication. Rel.AI keeps the local connection private.')),
    h('section', { className: 'chatgpt-connector-handoff', 'aria-label': 'ChatGPT connector setup' },
      h('dl', { className: 'chatgpt-connector-values' }, h('dt', null, 'Name'), h('dd', null, 'Rel.AI MCP'), h('dt', null, 'Connection'), h('dd', null, 'Tunnel'), h('dt', null, 'Tunnel'), h('dd', { className: 'mono' }, tunnelId || 'Select this computer’s tunnel'), h('dt', null, 'Authentication'), h('dd', null, 'No authentication')),
      h('div', { className: 'chatgpt-connector-actions', role: 'group', 'aria-label': 'ChatGPT connector setup actions' },
        h('button', { className: 'primary', type: 'button', onClick: () => window.open(CHATGPT_CONNECTOR_CREATE_URL, '_blank', 'noopener,noreferrer') }, 'ChatGPT setup'),
        h('button', { className: 'secondary', type: 'button', onClick: saveIcon }, iconSaved ? `Optional icon saved · ${RELAI_CONNECTOR_ICON_FILENAME}` : h(React.Fragment, null, 'Save optional Rel.AI icon ', h('span', null, 'PNG · under 10 KB')))
      ),
      h('p', { className: 'chatgpt-connector-note' }, iconSaved ? 'The icon is optional. Open ChatGPT setup when you are ready.' : 'Open ChatGPT now. You can add the Rel.AI icon after the connector works.')
    ),
    h('ol', null, steps.map(step => h('li', { key: step }, step)))
  );
}

function primaryActiveTask(tasks) { return tasks.find(item => Number(item.activeCalls || 0) > 0) || tasks[0]; }
function semanticProgressFor(task = {}) { return task.semanticProgress && typeof task.semanticProgress === 'object' ? task.semanticProgress : buildTaskSemanticProgress(task); }
function activeTaskLocation(tasks) {
  const workspaces = [...new Set(tasks.map(item => item.workspace).filter(Boolean))];
  if (workspaces.length === 1) return workspaces[0];
  if (workspaces.length > 1) return `${workspaces.length} projects`;
  return 'your projects';
}
function taskAction(tool) {
  const value = String(tool || '');
  if (/run_checks|browser/.test(value)) return 'Checking changes';
  if (/diff|git_status/.test(value)) return 'Reviewing changes';
  if (/git_draft_pr|git_create_pr/.test(value)) return 'Preparing pull request text';
  if (/git_commit|git_push/.test(value)) return 'Publishing changes';
  if (/edit|write|replace|tidy_run|restore|reset_workspace/.test(value)) return 'Applying changes';
  return 'Looking through the project';
}
function StatusPill({ value, classOverride = '' }) {
  const cls = String(classOverride || pillClass(value)).trim();
  return h('span', { className: `status-pill${cls ? ` ${cls}` : ''}` },
    String(value || 'unknown'),
    h('span', { className: 'sr-only' }, ` (${statusTone(value)})`)
  );
}

function TaskProgress({ progress, status, compact = false }) {
  const view = taskProgressView(progress, status, { compact });
  const attributes = {
    className: view.className,
    role: view.role || undefined,
    'aria-label': view.ariaLabel || undefined
  };
  const label = h('div', { className: 'task-progress-label' },
    h('span', null, view.label),
    view.state ? h('strong', null, view.state) : null
  );
  if (view.kind === 'static') return h('div', attributes, label);
  if (view.kind === 'indeterminate') {
    return h('div', attributes,
      label,
      h('div', { className: 'task-progress-track', 'aria-hidden': 'true' })
    );
  }
  return h('div', attributes,
    label,
    h('progress', {
      className: 'task-progress-track',
      'aria-label': view.progressAriaLabel,
      value: view.value,
      max: 100
    })
  );
}

function recentTaskStatusProps(task) {
  const status = String(task?.status || '');
  if (status === 'failed') return { value: 'failed' };
  if (status === 'blocked') { const state = workSessionStateView(task); return { value: state.label.toLowerCase(), classOverride: state.pillClass }; }
  if (status === 'completed') return { value: 'completed' };
  if (status === 'running' || status === 'working') return { value: 'running' };
  if (status === 'validating') return { value: 'validating' };
  if (status === 'validation_failed') return { value: 'validation failed' };
  if (status === 'expired') return { value: 'expired' };
  if (status === 'inactive') return { value: 'inactive' };
  if (status === 'cancelled') return { value: 'cancelled' };
  if (['queued', 'planning', 'waiting_for_approval', 'waiting', 'settling'].includes(status)) return { value: 'open' };
  return { value: 'unknown' };
}
function statusLabel(status) { return String(status || 'open').replaceAll('_', ' '); }
function pluralLabel(count, singular) { return Number(count) === 1 ? singular : `${singular}s`; }
