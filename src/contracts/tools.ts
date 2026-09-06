import type { ApprovalRequirement } from './authorization.ts';

export interface ToolAction {
  readonly publicTool: string;
  readonly action: string;
  readonly operationName: string;
  readonly keepAction: boolean;
  readonly title: string;
  readonly description: string;
  readonly fields: readonly string[];
  readonly required: readonly string[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: Readonly<Record<string, unknown>>;
  readonly behavior: Readonly<Record<string, unknown>>;
  readonly execution?: Readonly<Record<string, unknown>>;
  readonly dashboard: Readonly<Record<string, unknown>>;
  readonly groups: readonly string[];
  readonly capability: string;
  readonly approval: ((args: Record<string, unknown>) => ApprovalRequirement) | null;
  readonly handlerName: string;
}
