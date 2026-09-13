import type { TaskDto } from './tasks.ts';

export interface WorkspaceActivityDto {
  state?: string;
  tool?: string;
  startedAt?: number | string | null;
  activeCalls?: number;
  taskId?: string;
}

export interface WorkspaceStateDto {
  exists: boolean;
  isGit: boolean;
  branch: string | null;
  unborn: boolean;
  ahead: number;
  behind: number;
  dirty: boolean;
  changedFileCount: number;
  sessionChangedFileCount: number;
  remotes: string[];
  remoteAvailable: boolean;
  currentActivity?: WorkspaceActivityDto | null;
  lastTask?: TaskDto | null;
  lastValidation?: { status?: string; completedAt?: string | null } | null;
  [key: string]: unknown;
}

export function createWorkspaceUpdatePayload(alias: string, state: WorkspaceStateDto): { alias: string; state: WorkspaceStateDto } {
  return { alias: String(alias || ''), state: state && typeof state === 'object' ? state : {} as WorkspaceStateDto };
}
