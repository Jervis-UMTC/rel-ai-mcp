import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import {
  PERFORMANCE_PHASES,
  type PerformanceBreakdownOptions,
  type PerformanceBreakdownRecorder,
  type PerformanceBreakdownSnapshot,
  type PerformancePhase,
  type PerformancePhaseCounts,
  type PerformancePhaseDurations,
  type PerformanceSnapshotInput
} from './telemetry.types.ts';

const MAX_PHASE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const PERFORMANCE_PHASE_SET = new Set<string>(PERFORMANCE_PHASES);
const performanceContext = new AsyncLocalStorage<PerformanceBreakdownRecorder>();

function createPerformanceBreakdown(options: PerformanceBreakdownOptions = {}): PerformanceBreakdownRecorder {
  const now = typeof options.now === 'function' ? options.now : () => performance.now();
  const startedAt = now();
  const phaseMs = Object.create(null) as PerformancePhaseDurations;
  const counts = Object.create(null) as PerformancePhaseCounts;

  function add(name: unknown, durationMs: unknown): boolean {
    const phase = canonicalPerformancePhase(name);
    const duration = boundedDuration(durationMs);
    if (!phase || duration == null) return false;
    phaseMs[phase] = Number(phaseMs[phase] || 0) + duration;
    counts[phase] = Number(counts[phase] || 0) + 1;
    return true;
  }

  async function measure<T>(name: unknown, operation: () => T | Promise<T>): Promise<T> {
    const phaseStartedAt = now();
    try {
      return await operation();
    } finally {
      add(name, now() - phaseStartedAt);
    }
  }

  function measureSync<T>(name: unknown, operation: () => T): T {
    const phaseStartedAt = now();
    try {
      return operation();
    } finally {
      add(name, now() - phaseStartedAt);
    }
  }

  function snapshot(): PerformanceBreakdownSnapshot {
    return {
      totalMs: roundDuration(now() - startedAt),
      phaseMs: sanitizePerformancePhases(phaseMs),
      counts: sanitizePerformanceCounts(counts)
    };
  }

  return Object.freeze({ add, measure, measureSync, snapshot });
}

function withPerformanceBreakdown<T>(operation: (recorder: PerformanceBreakdownRecorder) => T, options: PerformanceBreakdownOptions = {}): T {
  const recorder = createPerformanceBreakdown(options);
  return performanceContext.run(recorder, () => operation(recorder));
}

function currentPerformanceBreakdown(): PerformanceBreakdownRecorder | null {
  return performanceContext.getStore() || null;
}

function withPerformanceBreakdownIfAbsent<T>(operation: (recorder: PerformanceBreakdownRecorder) => T, options: PerformanceBreakdownOptions = {}): T {
  const current = currentPerformanceBreakdown();
  return current ? operation(current) : withPerformanceBreakdown(operation, options);
}

function recordPerformancePhase(name: unknown, durationMs: unknown): boolean {
  return currentPerformanceBreakdown()?.add(name, durationMs) === true;
}

function measurePerformancePhase<T>(name: unknown, operation: () => T | Promise<T>): T | Promise<T> {
  const recorder = currentPerformanceBreakdown();
  return recorder ? recorder.measure(name, operation) : operation();
}

function measurePerformancePhaseSync<T>(name: unknown, operation: () => T): T {
  const recorder = currentPerformanceBreakdown();
  return recorder ? recorder.measureSync(name, operation) : operation();
}

function performanceBreakdownSnapshot(): PerformanceBreakdownSnapshot {
  return currentPerformanceBreakdown()?.snapshot() || { totalMs: 0, phaseMs: {}, counts: {} };
}

function sanitizePerformancePhases(value: unknown = {}): PerformancePhaseDurations {
  const safe: PerformancePhaseDurations = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return safe;
  const source = value as Record<string, unknown>;
  for (const phase of PERFORMANCE_PHASES) {
    const duration = boundedDuration(source[phase]);
    if (duration != null && duration > 0) safe[phase] = roundDuration(duration);
  }
  return safe;
}

function sanitizePerformanceCounts(value: unknown = {}): PerformancePhaseCounts {
  const safe: PerformancePhaseCounts = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return safe;
  const source = value as Record<string, unknown>;
  for (const phase of PERFORMANCE_PHASES) {
    const count = Math.max(0, Math.floor(Number(source[phase]) || 0));
    if (count > 0) safe[phase] = count;
  }
  return safe;
}

function performanceTimingAttributes(snapshot: PerformanceSnapshotInput = performanceBreakdownSnapshot()): Record<string, number> {
  const attributes: Record<string, number> = {};
  const phaseMs = sanitizePerformancePhases(snapshot.phaseMs);
  const counts = sanitizePerformanceCounts(snapshot.counts);
  for (const phase of PERFORMANCE_PHASES) {
    const durationMs = phaseMs[phase];
    if (durationMs == null) continue;
    attributes[`relai.timing.${phase}_ms`] = durationMs;
    const count = Number(counts[phase] || 0);
    if (count > 1) attributes[`relai.timing.${phase}_count`] = count;
  }
  return attributes;
}

function canonicalPerformancePhase(value: unknown): PerformancePhase | '' {
  const phase = String(value || '').trim();
  return PERFORMANCE_PHASE_SET.has(phase) ? phase as PerformancePhase : '';
}

function boundedDuration(value: unknown): number | null {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0) return null;
  return Math.min(MAX_PHASE_DURATION_MS, duration);
}

function roundDuration(value: unknown): number {
  return Number(Math.max(0, Number(value) || 0).toFixed(2));
}

export {
  createPerformanceBreakdown,
  measurePerformancePhase,
  measurePerformancePhaseSync,
  performanceBreakdownSnapshot,
  performanceTimingAttributes,
  recordPerformancePhase,
  sanitizePerformancePhases,
  withPerformanceBreakdown,
  withPerformanceBreakdownIfAbsent
};

