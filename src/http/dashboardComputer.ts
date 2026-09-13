import { computerControlSettingsPatchSchema } from '../contracts/computer.ts';
import { getComputerControlState, updateComputerControlEnabled } from '../core/computer.ts';
import { readJsonBody, sendJson } from './io.ts';
import type { HttpRouteContext } from './types.ts';

async function handleApiComputer(ctx: HttpRouteContext): Promise<void> {
  sendJson(ctx.res, 200, await getComputerControlState());
}

async function handleApiComputerAction(ctx: HttpRouteContext): Promise<void> {
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const parsed = computerControlSettingsPatchSchema.safeParse(payload);
    if (!parsed.success) throw new Error('Computer control enabled must be a boolean.');
    sendJson(ctx.res, 200, await updateComputerControlEnabled(parsed.data.enabled));
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export { handleApiComputer, handleApiComputerAction };
