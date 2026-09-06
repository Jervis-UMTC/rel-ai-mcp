import os from 'node:os';

const availableParallelism = Math.max(1, Number(os.availableParallelism?.() || os.cpus().length || 1));
const DEFAULT_HEAVY_WORK_LIMIT = Math.min(4, Math.max(2, availableParallelism - 1));
const DEFAULT_PERSISTENT_PROCESS_LIMIT = Math.min(12, Math.max(4, availableParallelism * 2));

const HOST_HEAVY_WORK_LIMIT = configuredLimit('REL_AI_MCP_HEAVY_WORK_LIMIT', DEFAULT_HEAVY_WORK_LIMIT);
const HOST_REPOSITORY_QUERY_LIMIT = 4;
const HOST_PERSISTENT_PROCESS_LIMIT = configuredLimit('REL_AI_MCP_PERSISTENT_PROCESS_LIMIT', DEFAULT_PERSISTENT_PROCESS_LIMIT);

function createFairResourceScheduler(limits = {}) {
  const lanes = new Map(Object.entries(limits).map(([name, limit]) => [name, createLane(limit)]));

  function acquire(resourceClass, owner, options = {}) {
    const laneName = String(resourceClass || '').trim();
    const lane = lanes.get(laneName);
    if (!lane) throw new Error(`Unknown host resource class '${laneName}'.`);
    if (options.signal?.aborted) return Promise.reject(resourceAbortError(options.signal.reason));

    const ownerKey = String(owner || 'global').trim() || 'global';
    const timeoutMs = positiveTimeout(options.timeoutMs, 0);
    const queuedAt = Date.now();

    return new Promise((resolve, reject) => {
      const ticket = {
        owner: ownerKey,
        queuedAt,
        resolve,
        reject,
        signal: options.signal,
        timer: null,
        onAbort: null,
        settled: false
      };

      ticket.onAbort = () => rejectQueuedTicket(lane, ticket, resourceAbortError(ticket.signal?.reason));
      if (ticket.signal) ticket.signal.addEventListener('abort', ticket.onAbort, { once: true });
      if (timeoutMs > 0) {
        ticket.timer = setTimeout(() => {
          const error = new Error(`Host resource '${laneName}' queue wait exceeded ${timeoutMs}ms.`);
          error.code = 'HOST_RESOURCE_QUEUE_TIMEOUT';
          error.retryable = true;
          rejectQueuedTicket(lane, ticket, error);
        }, timeoutMs);
        ticket.timer.unref?.();
      }

      enqueueTicket(lane, ticket);
      drainLane(lane, laneName);
    });
  }

  function stats() {
    return Object.fromEntries([...lanes.entries()].map(([name, lane]) => [name, {
      limit: lane.limit,
      active: lane.active,
      queued: queuedCount(lane),
      queuedOwners: lane.order.length
    }]));
  }

  return Object.freeze({ acquire, stats });
}

function createLane(limit) {
  return {
    limit: Math.max(1, Math.floor(Number(limit) || 1)),
    active: 0,
    queues: new Map(),
    order: []
  };
}

function enqueueTicket(lane, ticket) {
  let queue = lane.queues.get(ticket.owner);
  if (!queue) {
    queue = [];
    lane.queues.set(ticket.owner, queue);
    lane.order.push(ticket.owner);
  }
  queue.push(ticket);
}

function drainLane(lane, laneName) {
  while (lane.active < lane.limit && lane.order.length > 0) {
    const owner = lane.order.shift();
    const queue = lane.queues.get(owner);
    if (!queue?.length) {
      lane.queues.delete(owner);
      continue;
    }

    const ticket = queue.shift();
    if (queue.length > 0) lane.order.push(owner);
    else lane.queues.delete(owner);
    if (!ticket || ticket.settled) continue;

    ticket.settled = true;
    cleanupTicket(ticket);
    lane.active += 1;
    let released = false;
    ticket.resolve({
      resourceClass: laneName,
      owner,
      waitMs: Date.now() - ticket.queuedAt,
      release() {
        if (released) return;
        released = true;
        lane.active = Math.max(0, lane.active - 1);
        drainLane(lane, laneName);
      }
    });
  }
}

function rejectQueuedTicket(lane, ticket, error) {
  if (ticket.settled) return;
  ticket.settled = true;
  cleanupTicket(ticket);
  const queue = lane.queues.get(ticket.owner);
  if (queue) {
    const index = queue.indexOf(ticket);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) {
      lane.queues.delete(ticket.owner);
      lane.order = lane.order.filter(owner => owner !== ticket.owner);
    }
  }
  ticket.reject(error);
}

function cleanupTicket(ticket) {
  if (ticket.timer) clearTimeout(ticket.timer);
  ticket.signal?.removeEventListener?.('abort', ticket.onAbort);
}

function queuedCount(lane) {
  let total = 0;
  for (const queue of lane.queues.values()) total += queue.length;
  return total;
}

function resourceAbortError(reason) {
  const error = reason instanceof Error
    ? new Error(reason.message, { cause: reason })
    : new Error('Host resource wait was cancelled.');
  error.name = 'AbortError';
  error.code = 'HOST_RESOURCE_ABORTED';
  error.retryable = true;
  return error;
}

function configuredLimit(name, fallback) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(64, Math.max(1, Math.floor(value)));
}

function positiveTimeout(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

const hostResourceScheduler = createFairResourceScheduler({
  heavy: HOST_HEAVY_WORK_LIMIT,
  repositoryQuery: HOST_REPOSITORY_QUERY_LIMIT,
  persistent: HOST_PERSISTENT_PROCESS_LIMIT
});

function acquireHostResource(resourceClass, owner, options = {}) {
  return hostResourceScheduler.acquire(resourceClass, owner, options);
}

function hostResourceStats() {
  return hostResourceScheduler.stats();
}

export {
  HOST_PERSISTENT_PROCESS_LIMIT,
  acquireHostResource,
  createFairResourceScheduler,
  hostResourceStats
};
