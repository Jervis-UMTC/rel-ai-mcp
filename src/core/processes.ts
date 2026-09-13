import { readConfig } from '../config.js';
import { stopManagedProcess } from '../processManager.js';

export function stopCoreManagedProcess(processId: string, graceMs = 3000): Promise<Record<string, unknown>> {
  return stopManagedProcess(readConfig(), { processId, graceMs }) as Promise<Record<string, unknown>>;
}
