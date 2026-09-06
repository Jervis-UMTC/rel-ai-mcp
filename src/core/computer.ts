import { readConfig, writeConfig } from '../config.js';
import { computerControlSettings, readComputerStatus } from '../computerManager.js';

export async function getComputerControlState(): Promise<Record<string, unknown>> {
  const config = readConfig();
  return {
    ok: true,
    settings: computerControlSettings(config),
    status: await readComputerStatus(config)
  };
}

export async function updateComputerControlEnabled(enabled: boolean): Promise<Record<string, unknown>> {
  const current = readConfig();
  const next = structuredClone(current);
  next.computerControl = { enabled };
  const config = writeConfig(next);
  return {
    ok: true,
    settings: computerControlSettings(config),
    status: await readComputerStatus(config)
  };
}
