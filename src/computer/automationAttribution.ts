import { principalFingerprint } from '../mcp/principal.ts';
import { onToolActivity, taskError } from '../toolActivity.js';

const TERMINAL_TASK_PHASES = new Set(['completed', 'cancelled', 'inactive']);

interface AutomationWorkspace {
  readonly alias: string;
}

interface AutomationArgs {
  readonly work_id?: unknown;
}

interface AutomationContext {
  readonly taskId?: unknown;
  readonly principal?: unknown;
}

interface AutomationAttribution {
  readonly workspaceId: string;
  readonly taskId: string;
  readonly principalFingerprint: string;
}

function taskIdFor(args: AutomationArgs = {}, context: AutomationContext = {}): string {
  return String(context.taskId || args.work_id || '').trim();
}

function createAutomationAttribution(
  workspace: AutomationWorkspace,
  args: AutomationArgs = {},
  context: AutomationContext = {}
): AutomationAttribution {
  return Object.freeze({
    workspaceId: workspace.alias,
    taskId: taskIdFor(args, context),
    principalFingerprint: principalFingerprint(context.principal)
  });
}

function assertAutomationAttribution(
  expected: AutomationAttribution,
  workspace: AutomationWorkspace,
  args: AutomationArgs = {},
  context: AutomationContext = {}
): void {
  if (expected.workspaceId !== workspace.alias) {
    throw taskError('UI_SESSION_WORKSPACE_MISMATCH', 'UI test session belongs to a different workspace.');
  }
  if (expected.principalFingerprint !== principalFingerprint(context.principal)) {
    throw taskError('UI_SESSION_PRINCIPAL_MISMATCH', 'UI test session belongs to a different authenticated client.');
  }
  const taskId = taskIdFor(args, context);
  if (taskId && expected.taskId && taskId !== expected.taskId) {
    throw taskError('UI_SESSION_TASK_MISMATCH', 'The supplied work_id does not match this UI session attribution.');
  }
}

function registerTerminalTaskCleanup(cleanup: (taskId: string) => Promise<unknown> | unknown): () => void {
  return onToolActivity((activity: {
    phase?: unknown;
    taskId?: unknown;
    task?: { taskId?: unknown; id?: unknown };
  }) => {
    if (!TERMINAL_TASK_PHASES.has(String(activity?.phase || ''))) return;
    const taskId = String(activity?.taskId || activity?.task?.taskId || activity?.task?.id || '').trim();
    if (taskId) void cleanup(taskId);
  });
}

export { assertAutomationAttribution, createAutomationAttribution, registerTerminalTaskCleanup, taskIdFor };
export type { AutomationAttribution, AutomationContext, AutomationWorkspace };
