import assert from 'node:assert/strict';

import {
  createPerformanceBreakdown,
  measurePerformancePhase,
  performanceBreakdownSnapshot,
  performanceTimingAttributes,
  sanitizePerformancePhases,
  withPerformanceBreakdown
} from '../src/performanceObservability.js';

let clock = 0;
const recorder = createPerformanceBreakdown({ now: () => clock });
recorder.add('repo.lookup', 12.345);
recorder.add('repo.lookup', 7.655);
recorder.add('unknown.phase', 999);
clock = 25;
assert.deepEqual(recorder.snapshot(), {
  totalMs: 25,
  phaseMs: { 'repo.lookup': 20 },
  counts: { 'repo.lookup': 2 }
});

const sanitized = sanitizePerformancePhases({
  'repo.lookup': 4.25,
  'mcp.authorization': 1,
  'user.supplied.secret.phase': 500,
  'repo.index_refresh': Number.POSITIVE_INFINITY
});
assert.deepEqual(sanitized, {
  'mcp.authorization': 1,
  'repo.lookup': 4.25
});

await withPerformanceBreakdown(async () => {
  await measurePerformancePhase('tool.execution', async () => {
    await Promise.resolve();
  });
  const snapshot = performanceBreakdownSnapshot();
  assert.ok(snapshot.phaseMs['tool.execution'] >= 0);
  const attributes = performanceTimingAttributes({
    phaseMs: { 'repo.lookup': 20, 'tool.execution': 40 },
    counts: { 'repo.lookup': 2, 'tool.execution': 1 }
  });
  assert.deepEqual(attributes, {
    'relai.timing.repo.lookup_ms': 20,
    'relai.timing.repo.lookup_count': 2,
    'relai.timing.tool.execution_ms': 40
  });
});

assert.deepEqual(performanceBreakdownSnapshot(), { totalMs: 0, phaseMs: {}, counts: {} });

console.log('Performance observability uses bounded canonical phases and async request scope.');
