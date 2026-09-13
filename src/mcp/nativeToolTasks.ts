import type { Principal } from '../contracts/authorization.ts';
import {
  completeNativeTask,
  createNativeTask,
  failNativeTask,
  nativeTaskSignal,
  pruneNativeTasks,
  retryNativeTaskOperation
} from './nativeTaskService.js';

interface NativeToolTaskConfig extends Record<string, unknown> {
  stateDir?: string;
}

interface NativeToolTaskOptions {
  method?: string | undefined;
  name?: string | undefined;
  logicalTaskId?: string | undefined;
  principal?: Principal | undefined;
  message?: string | undefined;
  workspace?: string | undefined;
}

// Tool calls may legally run for 24 hours. Keep the durable task record alive
// beyond that execution ceiling so queue/startup/response overhead cannot outlive it.
const TOOL_TASK_TTL_MS = 25 * 60 * 60 * 1000;

function createNativeToolTask(config: NativeToolTaskConfig, options: NativeToolTaskOptions = {}) {
  const controller = new AbortController();
  return createNativeTask(config, {
    method: options.method,
    name: options.name,
    logicalTaskId: options.logicalTaskId,
    principal: options.principal,
    ttlMs: TOOL_TASK_TTL_MS,
    pollIntervalMs: 1000,
    statusMessage: options.message || 'Tool execution started.',
    restartPolicy: 'non_resumable',
    executor: { controller },
    internal: {
      workspace: String(options.workspace || '')
    }
  });
}

function completeNativeToolTask(config: NativeToolTaskConfig, taskId: unknown, result: unknown) {
  return retryNativeTaskOperation(() => completeNativeTask(config, taskId, result, {
    statusMessage: 'Tool execution completed.'
  }));
}

function failNativeToolTask(config: NativeToolTaskConfig, taskId: unknown, error: unknown) {
  return retryNativeTaskOperation(() => failNativeTask(config, taskId, error, {
    statusMessage: 'Tool execution failed.'
  }));
}

function nativeToolTaskSignal(taskId: unknown): AbortSignal | undefined {
  return nativeTaskSignal(taskId);
}

function pruneNativeToolTasks(config: NativeToolTaskConfig) {
  return retryNativeTaskOperation(() => pruneNativeTasks(config));
}

export {
  completeNativeToolTask,
  createNativeToolTask,
  failNativeToolTask,
  nativeToolTaskSignal,
  pruneNativeToolTasks
};
