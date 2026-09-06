import type { ComputerControlSettingsDto } from '../contracts/computer.ts';

interface ComputerControlConfig {
  readonly computerControl?: { readonly enabled?: unknown };
}

class ComputerControlDisabledError extends Error {
  readonly code = 'COMPUTER_CONTROL_DISABLED' as const;
  readonly source = 'rel-ai-mcp-policy' as const;
  readonly operation = 'computer_control' as const;
  readonly retryable = false;
  readonly requiresUserConfirmation = false;
  readonly allowedAlternatives = Object.freeze([
    'Enable Computer control in Rel.AI Settings > App, then retry the requested computer action.'
  ]);

  constructor() {
    super('Computer control is disabled by the local Rel.AI setting. Do not retry this computer action or request MCP approval. Ask the user to enable Computer control in Rel.AI Settings > App, then retry after the setting is enabled.');
    this.name = 'ComputerControlDisabledError';
  }
}

function computerControlSettings(config: ComputerControlConfig | null | undefined): ComputerControlSettingsDto {
  return Object.freeze({ enabled: config?.computerControl?.enabled === true });
}

function assertComputerControlEnabled(config: ComputerControlConfig | null | undefined): void {
  if (!computerControlSettings(config).enabled) throw new ComputerControlDisabledError();
}

export { assertComputerControlEnabled, computerControlSettings };
export type { ComputerControlConfig };
