import { stopCoreManagedProcess } from '../core/processes.ts';
import { readJsonBody, sendJson } from './io.ts';
import type { HttpRouteContext } from './types.ts';

async function handleApiProcessStop(ctx: HttpRouteContext): Promise<void> {
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const processId = String(payload.processId || '').trim();
    if (!processId) throw new Error('processId is required.');
    const graceMs = payload.graceMs === undefined ? 3000 : Number(payload.graceMs);
    if (!Number.isFinite(graceMs) || graceMs < 0 || graceMs > 30_000) {
      throw new Error('graceMs must be between 0 and 30000 milliseconds.');
    }
    sendJson(ctx.res, 200, await stopCoreManagedProcess(processId, graceMs));
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export { handleApiProcessStop };
