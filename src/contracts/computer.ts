import { z } from 'zod';

export interface ComputerControlSettingsDto {
  enabled: boolean;
}

export interface ComputerControlStatusDto {
  ok: true;
  action: 'status';
  enabled: boolean;
  available: boolean;
  platform: string;
  engine: string;
  displays?: number;
  message?: string;
  workspace?: string;
  approvedApps?: string[];
  controlling?: boolean;
  lockedBy?: string;
  lockSince?: string;
  banner?: string;
}

export interface ComputerControlResultDto {
  ok: boolean;
  workspace?: string;
  action: string;
  platform?: string;
  engine?: string;
  [key: string]: unknown;
}

export const computerControlSettingsPatchSchema = z.object({ enabled: z.boolean() }).passthrough();
