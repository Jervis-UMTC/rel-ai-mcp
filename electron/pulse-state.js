import { importResourceModule } from './resource-path.js';

const { classifyTaskActivity } = await importResourceModule('src/taskActivityPresentation.js');

function projectPulseStatus(status = {}) {
  const activity = status?.taskActivity && typeof status.taskActivity === 'object' ? status.taskActivity : {};
  const presentation = classifyTaskActivity(activity);
  const {
    activeCalls,
    attentionTask,
    primaryTask: primary,
    taskCount,
    tasks
  } = presentation;
  const route = taskRoute(primary);

  if (presentation.category === 'attention') return attentionModel(attentionTask, taskCount, route, tasks);
  if (presentation.category === 'working') {
    return {
      visible: true,
      tone: 'working',
      badge: activeCalls === 1 ? '1 running' : `${Math.max(1, activeCalls)} running`,
      title: cleanText(primary?.currentStage || primary?.currentActivity || activity.operation || operationLabel(activity.tool || primary?.lastTool), 96),
      detail: taskDetail(primary, taskCount, 'Rel.AI is using this computer now.'),
      route,
      taskCount,
      ...taskPresentation(primary, taskCount, tasks),
      actionRequired: false
    };
  }
  if (presentation.category === 'waiting') {
    return {
      visible: true,
      tone: 'waiting',
      badge: taskCount === 1 ? '1 open' : `${Math.max(1, taskCount)} open`,
      title: taskCount > 1 ? `${taskCount} tasks are open` : cleanText(primary?.title || 'Waiting for the next local action', 96),
      detail: taskDetail(primary, taskCount, 'ChatGPT may still be working. Rel.AI is ready for the next local action.'),
      route,
      taskCount,
      ...taskPresentation(primary, taskCount, tasks),
      actionRequired: false
    };
  }

  if (status.error || status.errorCode || normalizeStatus(status.tunnelStatus) === 'failed') {
    return {
      visible: true,
      tone: 'attention',
      badge: 'Needs attention',
      title: 'Rel.AI needs attention',
      detail: 'Open Rel.AI for connection details and recovery options.',
      route: '#diagnostics',
      taskCount: 0,
      actionRequired: false
    };
  }
  return {
    visible: false,
    tone: 'idle',
    badge: 'Idle',
    title: 'Rel.AI is idle',
    detail: '',
    route: '#home',
    taskCount: 0,
    actionRequired: false
  };
}

function attentionModel(task, taskCount, route, tasks) {
  const status = normalizeStatus(task.status);
  const title = status === 'waiting_for_approval'
    ? 'Approval required'
    : status === 'validation_failed'
      ? 'Checks need attention'
      : 'Resolve the blocker to continue';
  const fallback = status === 'waiting_for_approval'
    ? 'The task is paused until the required approval is handled in the AI host.'
    : status === 'validation_failed'
      ? 'Review the failed checks, fix the issue, then validate again.'
      : 'Open the task to see what is blocking progress.';
  return {
    visible: true,
    tone: 'attention',
    badge: 'Action required',
    title,
    detail: taskDetail(task, taskCount, cleanText(task.currentActivity || task.errorSummary || fallback, 140)),
    route,
    taskCount,
    ...taskPresentation(task, taskCount, tasks),
    actionRequired: true
  };
}

function taskPresentation(task, taskCount, tasks = []) {
  const taskNames = (Array.isArray(tasks) ? tasks : [])
    .map(candidate => cleanText(candidate?.title || candidate?.objective, 72))
    .filter(Boolean)
    .slice(0, 3);
  if (!task || typeof task !== 'object') return { otherTaskCount: Math.max(0, taskCount - 1), taskNames };
  const progressPercent = Number(task.progress?.percent);
  const presentation = {
    contextTitle: cleanText(task.title || task.objective, 96),
    workspace: cleanText(task.workspace, 80),
    progressLabel: cleanText(task.progress?.label, 80),
    otherTaskCount: Math.max(0, taskCount - 1),
    taskNames
  };
  if (Number.isFinite(progressPercent)) presentation.progressPercent = Math.min(100, Math.max(0, progressPercent));
  return presentation;
}

function taskDetail(task, taskCount, fallback) {
  const workspace = cleanText(task?.workspace, 60);
  const title = cleanText(task?.title || task?.objective, 80);
  if (taskCount > 1) {
    const scope = workspace ? ` across ${taskCount} tasks · ${workspace}` : ` across ${taskCount} tasks`;
    return cleanText(`${fallback}${scope}`, 180);
  }
  const context = [title, workspace].filter(Boolean).join(' · ');
  return cleanText(context ? `${fallback} ${context}` : fallback, 180);
}

function taskRoute(task) {
  const taskId = cleanText(task?.taskId || task?.id || task?.sessionId, 160);
  const workspace = cleanText(task?.workspace, 80);
  if (!taskId && !workspace) return '#tasks';
  const params = new URLSearchParams();
  if (workspace) params.set('workspace', workspace);
  if (taskId) params.set('task', taskId);
  return `#tasks?${params.toString()}`;
}

function operationLabel(tool) {
  const value = String(tool || '').toLowerCase();
  if (/validate|check/.test(value)) return 'Checking changes';
  if (/edit|write|replace/.test(value)) return 'Applying changes';
  if (/publish|commit|push/.test(value)) return 'Publishing changes';
  if (/browser/.test(value)) return 'Using the local browser';
  if (/computer|desktop/.test(value)) return 'Using this computer';
  if (/exec|process/.test(value)) return 'Running a local command';
  return 'Working locally';
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_');
}

function cleanText(value, limit = 180) {
  const text = String(value || '').replace(/[\r\n\t\0]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export { projectPulseStatus, taskRoute };
