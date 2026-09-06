export interface AtomicPersistenceResult {
  readonly path: string;
  readonly backupPath: string | null;
}

export interface DatabasePersistenceResult extends Record<string, unknown> {
  readonly ok: true;
  readonly path: string;
  readonly recovered?: boolean;
  readonly skipped?: boolean;
  readonly backupPath?: string;
}

export type PersistenceResult = AtomicPersistenceResult | DatabasePersistenceResult;

export interface PersistenceFailure extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}
