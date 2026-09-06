import { deltaFor } from './range-model.js';

const METRIC_HELP = Object.freeze({
  toolCalls: 'Total Rel.AI tool actions recorded in this range. The change compares with the previous equivalent period.',
  reliabilityRate: 'Share of measured, non-cancelled actions without a Rel.AI system error. “pp” means percentage points. A change from 90% to 95% is +5 pp.',
  infrastructureFailures: 'Actions with Rel.AI system errors. Expected command failures, check failures, and cancellations are excluded.',
  recoverableFailures: 'Actions with a recoverable task or context problem. A retry or context refresh can usually resolve the problem.',
  operationSuccessRate: 'Share of recorded actions where the requested command or check succeeded. Rate changes use percentage points (pp).',
  averageDuration: 'Average elapsed time per completed action in this range. The change compares with the previous equivalent period when available.'
});

export function analyticsMetrics(scope, previous) {
  const values = key => scope.points.map(point => pointMetric(point, key));
  const compare = (key, options = {}) => scope.usedMonthlyFallback || options.available === false || options.previousAvailable === false
    ? null
    : deltaFor(scope, previous, key, options);
  const metric = (label, key, value, detail = '', options = {}) => ({
    key, label, value, detail, help: METRIC_HELP[key] || '',
    delta: compare(key, options), values: options.spark === false ? [] : values(options.sparkKey || key),
    tone: options.metricTone || ''
  });
  return [
    metric('Actions', 'toolCalls', integer(scope.toolCalls), '', { neutral: true }),
    metric('Reliable actions', 'reliabilityRate', scope.reliabilityCalls ? percent(scope.reliabilityRate) : '—', scope.reliabilityCalls ? `${integer(scope.reliabilityCalls)} measured actions` : 'Measured after new actions run', { rate: true, available: scope.reliabilityCalls > 0, previousAvailable: Number(previous?.reliabilityCalls || 0) > 0, spark: false }),
    metric('System errors', 'infrastructureFailures', integer(scope.infrastructureFailures), 'Rel.AI internal errors only', { inverse: true, metricTone: scope.infrastructureFailures ? 'bad' : 'good' }),
    metric('Retryable problems', 'recoverableFailures', integer(scope.recoverableFailures), 'Usually fixed by retrying or refreshing context', { inverse: true }),
    metric('Successful actions', 'operationSuccessRate', scope.completed ? percent(scope.operationSuccessRate) : '—', 'Whether the command or check itself succeeded', { rate: true, sparkKey: 'operationSuccessRate', available: scope.completed > 0, previousAvailable: Number(previous?.completed || 0) > 0 }),
    metric('Average time', 'averageDuration', duration(scope.averageDuration), scope.completed ? 'Per completed action' : '', { inverse: true, sparkKey: 'averageDuration', available: scope.completed > 0, previousAvailable: Number(previous?.completed || 0) > 0 })
  ];
}

export function pointMetric(point, key) {
  const completed = Number(point?.successes || 0) + Number(point?.failures || 0);
  if (key === 'reliabilityRate') return point?.reliabilityCalls ? Number(point.reliableCalls || 0) / Number(point.reliabilityCalls) * 100 : 0;
  if (key === 'operationSuccessRate' || key === 'successRate') return completed ? Number(point.successes || 0) / completed * 100 : 0;
  if (key === 'averageDuration') return completed ? Number(point.executionMs || 0) / completed : 0;
  return Number(point?.[key] || 0);
}

export function timelineModel(values, metricLabel = 'Actions') {
  const data = finite(values);
  const width = 720;
  const height = 180;
  const baseline = height - 12;
  if (!data.length || data.every(value => value === 0)) return { empty: true, data, width, height, baseline, coordinates: [], summary: 'No activity in this range.' };
  const max = Math.max(...data, 1);
  const coordinates = data.map((value, index) => ({
    index,
    value,
    x: data.length === 1 ? width / 2 : index / (data.length - 1) * width,
    y: baseline - value / max * (height - 32)
  }));
  const points = coordinates.map(point => `${point.x},${point.y}`).join(' ');
  const peak = Math.max(...data);
  const peakIndex = data.indexOf(peak);
  const bucketsAgo = Math.max(0, data.length - 1 - peakIndex);
  const latest = data.at(-1) || 0;
  const trend = latest > data[0] ? 'increasing' : latest < data[0] ? 'decreasing' : 'steady';
  return {
    empty: false,
    data,
    width,
    height,
    baseline,
    max,
    peak,
    peakIndex,
    latestIndex: data.length - 1,
    coordinates,
    points,
    area: `0,${baseline} ${points} ${width},${baseline}`,
    summary: `${metricLabel} trend. Peak ${formatChartValue(peak, metricLabel)} ${bucketsAgo ? `${bucketsAgo} periods ago` : 'in the latest period'}. Latest ${formatChartValue(latest, metricLabel)}. Overall trend ${trend}.`
  };
}

export function sparklineModel(values) {
  const data = finite(values);
  const width = 120;
  const height = 28;
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  return {
    width,
    height,
    points: data.map((value, index) => `${data.length === 1 ? width / 2 : index / (data.length - 1) * width},${height - 2 - value / max * (height - 5)}`).join(' ')
  };
}

export function failureCategoryLabel(category) {
  return ({ cancelled: 'Cancelled', timeout: 'Timed out', authorization: 'Sign-in', capacity: 'Busy', transport: 'Connection', policy: 'Safety rule', workspace: 'Project folder', git: 'Git', process: 'Command', validation: 'Input or check', runtime: 'App' })[String(category || '').toLowerCase()] || 'App';
}

export function integer(value) {
  return Math.floor(Number(value) || 0).toLocaleString();
}

function percent(value) {
  const number = Number(value) || 0;
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
}

export function duration(value) {
  const ms = Number(value) || 0;
  if (ms < 1000) return `${Math.floor(ms).toLocaleString()} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)} min`;
  return `${(minutes / 60).toFixed(2)} h`;
}

export function formatChartValue(value, metricLabel) {
  if (metricLabel === 'Reliable actions' || metricLabel === 'Successful actions' || metricLabel === 'Success rate') return percent(value);
  if (/duration|tool time|average time/i.test(metricLabel)) return duration(value);
  return integer(value);
}

function finite(values) {
  return (values || []).map(Number).map(value => Number.isFinite(value) && value >= 0 ? value : 0);
}
