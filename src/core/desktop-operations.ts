import { readConfig } from '../config.js';
import { readLocalUsageSnapshotAsync } from '../localAnalytics.js';
import { writeOnboardingState } from '../onboardingState.js';
import {
  describeTaskCodeWorkspace,
  readTaskCodeDiff,
  resolveTaskCodeWorkspacePath
} from '../taskCodeWorkspace.js';

function currentConfig(): Record<string, unknown> {
  return readConfig();
}

export function getDesktopLocalUsage(month?: string): Promise<Record<string, unknown>> {
  return readLocalUsageSnapshotAsync(currentConfig(), month) as Promise<Record<string, unknown>>;
}

export function markDesktopOnboardingHandoff(): Record<string, unknown> {
  return writeOnboardingState({
    completed: false,
    skipped: false,
    source: 'desktop-setup',
    handoffPending: true,
    updatedAt: new Date().toISOString()
  });
}

export function getDesktopTaskCodeWorkspace(payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return describeTaskCodeWorkspace(currentConfig(), payload) as Promise<Record<string, unknown>>;
}

export function readDesktopTaskCodeDiff(payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return readTaskCodeDiff(currentConfig(), payload) as Promise<Record<string, unknown>>;
}

export function getDesktopTaskCodeWorkspacePath(payload: Record<string, unknown> = {}): string {
  return resolveTaskCodeWorkspacePath(currentConfig(), String(payload.taskId || ''));
}
