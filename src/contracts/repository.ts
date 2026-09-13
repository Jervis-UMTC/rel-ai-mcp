export interface RepositoryOperationResult {
  readonly ok: boolean;
  readonly workspace: string;
  readonly operation?: string;
  readonly operationId?: string;
  readonly changedFiles?: readonly string[];
  readonly error?: string;
  readonly [key: string]: unknown;
}
