type JsonRecord = Record<string, unknown>;

const DASHBOARD_TASK_EVENT_COALESCE_MS = 50;

type TimerHandle = ReturnType<typeof setTimeout> | number;

interface DashboardTaskActivity extends JsonRecord {
  revision?: number;
  taskId?: string;
  phase?: string;
  task?: JsonRecord;
  activityEvent?: JsonRecord;
}

interface DashboardTaskBatch {
  revision: number;
  activities: DashboardTaskActivity[];
}

interface DashboardTaskEventBatcherOptions {
  delayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
  onFlush?: (batch: DashboardTaskBatch) => void;
}

function createDashboardTaskEventBatcher(options: DashboardTaskEventBatcherOptions = {}) {
  const delayMs = Math.max(0, Number(options.delayMs ?? DASHBOARD_TASK_EVENT_COALESCE_MS));
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const onFlush = typeof options.onFlush === 'function' ? options.onFlush : () => {};
  const pending = new Map<string, DashboardTaskActivity>();
  let timer: TimerHandle | null = null;
  let revision = 0;

  function push(activity: DashboardTaskActivity = {}): void {
    revision = Math.max(revision, Number(activity.revision || 0));
    pending.set(activityKey(activity), activity);
    if (timer) return;
    timer = setTimer(flush, delayMs);
    if (typeof timer !== 'number') timer.unref?.();
  }

  function flush(): boolean {
    if (timer) clearTimer(timer);
    timer = null;
    if (!pending.size) return false;
    const activities = [...pending.values()];
    pending.clear();
    const batchRevision = revision;
    revision = 0;
    onFlush({ revision: batchRevision, activities });
    return true;
  }

  function close(): void {
    if (timer) clearTimer(timer);
    timer = null;
    pending.clear();
    revision = 0;
  }

  return { push, flush, close, pendingCount: () => pending.size };
}

function activityKey(activity: DashboardTaskActivity = {}): string {
  const taskId = String(activity.taskId || activity.task?.taskId || activity.task?.id || 'observed');
  const eventId = String(activity.activityEvent?.eventId || activity.activityEvent?.operationId || '');
  return eventId ? `${taskId}:event:${eventId}` : `${taskId}:phase:${String(activity.phase || 'update')}`;
}

export { DASHBOARD_TASK_EVENT_COALESCE_MS, createDashboardTaskEventBatcher };
export type { DashboardTaskBatch };
