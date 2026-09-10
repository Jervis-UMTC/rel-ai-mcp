import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUsageModel, currentUsageMonth } from '../src/ui/features/usage/index.js';
import { analyticsBounds, analyticsRangeScope } from '../src/ui/features/usage/range-model.js';
import { loadAnalyticsData } from '../src/ui/features/usage/data.js';
import { analyticsMetrics, formatChartValue, pointMetric, timelineModel } from '../src/ui/features/usage/render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const navigationCatalog = read('src/ui/navigation-catalog.js');
const dashboard = read('public/dashboard.js');
const preload = read('electron/preload.cjs');
const ipc = read('electron/ipc-handlers-dashboard.js');
const desktopContract = read('src/contracts/desktop.ts');
const usageSource = read('src/ui/features/usage/index.js');
const usageReact = read('src/ui/features/usage/react.js');
const usageRender = read('src/ui/features/usage/render.js');
const settingsReact = read('src/ui/features/settings/react.js');
const reactMain = read('src/ui/react/main.js');
const usageRange = read('src/ui/features/usage/range-model.js');
const usageData = read('src/ui/features/usage/data.js');
const usageCss = read('src/ui/features/usage/styles.css');
const charts = read('src/ui/components/charts.js');
const homeReact = read('src/ui/features/home/react.js');
const workspacesReact = read('src/ui/features/workspaces/react.js');
const uiPackage = JSON.parse(read('src/ui/package.json'));
const usageCombined = `${usageSource}\n${usageReact}\n${usageRender}\n${usageRange}\n${usageData}`;

assert.match(navigationCatalog, /route\(['"]usage['"], ['"]Analytics['"]/);
assert.match(navigationCatalog, /See activity trends, reliability, and problem areas/i);
assert.doesNotMatch(dashboard, /usage: systemSection\(['"]usage['"]\)/, 'Analytics must not retain the legacy System renderer');
assert.match(reactMain, /registerReactSection\('usage'/, 'Analytics must be registered as a canonical React route');
assert.match(preload, /getLocalUsage: month => ipcRenderer\.invoke\(['"]desktop:analytics:local['"], month\)/);
assert.doesNotMatch(preload, /getGatewayUsage|desktop:gateway:usage/);
assert.match(desktopContract, /DESKTOP_ANALYTICS_LOCAL:\s*['"]desktop:analytics:local['"]/);
assert.match(ipc, /channels\.DESKTOP_ANALYTICS_LOCAL/);
assert.match(ipc, /Analytics month must use YYYY-MM/);
assert.doesNotMatch(ipc, /gateway/i);
assert.match(usageData, /desktop\.getLocalUsage/);
assert.doesNotMatch(`${usageSource}\n${usageData}`, /getGatewayUsage|connectionMode|pairing_required|cloudUsageAvailability/i);
assert.doesNotMatch(`${usageSource}\n${usageData}`, /fetch\(|DASHBOARD_DATA_URL|auditTail|taskActivity/);
assert.match(usageReact, /Analytics are stored on this computer\. Prompts, file paths, command output, and action results are not stored/i);
assert.match(usageReact, /data-usage-privacy/, 'Analytics must disclose local retention and external telemetry state');
assert.match(usageSource, /External developer telemetry is off/, 'Analytics must make the default external-telemetry state explicit');
assert.match(usageSource, /OTLP endpoint is configured, but the telemetry switch is disabled/, 'Analytics must distinguish a configured endpoint from an enabled exporter');
assert.match(usageSource, /raw exception messages are not exported/, 'Analytics must disclose the external trace redaction boundary');
assert.doesNotMatch(usageReact, /target: 'analytics', confirm: true/, 'Analytics page must not expose the destructive local-history clear action');
assert.match(settingsReact, /target: 'analytics', confirm: true/, 'Settings must retain an explicit local-history clear action');
assert.doesNotMatch(`${usageSource}\n${usageRender}`, /innerHTML|replaceChildren|insertAdjacentHTML/, 'Analytics model/view helpers must not retain the legacy DOM renderer');
assert.match(usageReact, /'data-usage-status': true, role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true'/);
assert.doesNotMatch(usageReact, /'data-usage-content'.*'aria-live'/);
assert.match(usageReact, /Analytics updated for \$\{bounds\.label\}/);
assert.match(usageReact, /taskRevision/, 'Analytics must refresh current local metrics from canonical live task activity');
assert.match(homeReact, /revisions\?\.task/, 'Overview analytics must refresh from canonical live task revisions');
assert.doesNotMatch(homeReact, /firstRequestObserved\s*\?\s*h\(HomeAnalytics/, 'Overview analytics must not disappear when volatile MCP request history resets on restart');
assert.doesNotMatch(homeReact, /firstRequestObserved\s*\?\s*h\(RecentTasksCard/, 'Persisted recent tasks must not disappear when volatile MCP request history resets on restart');
assert.match(workspacesReact, /taskRevision/, 'Project analytics must refresh from canonical live task revisions');
assert.match(workspacesReact, /Loading analytics…/, 'Project cards must show an explicit analytics loading state instead of a blank region');
assert.match(workspacesReact, /Analytics unavailable/, 'Project cards must show an explicit analytics failure state when initial analytics loading fails');
assert.doesNotMatch(workspacesReact, /setTimeout\(\(\) => \{[\s\S]{0,500}loadAnalyticsModels/, 'Project analytics must not wait on an arbitrary timer before starting the initial load');
assert.match(usageReact, /'aria-pressed': range === key \? 'true' : 'false'/);
assert.match(usageReact, /role: 'tooltip'/, 'Analytics metric help must expose tooltip semantics');
assert.match(usageReact, /'aria-describedby': helpId/, 'Analytics metric help triggers must reference their tooltip text');
assert.match(usageReact, /event\.key === 'Escape'/, 'Analytics metric tooltips must be dismissible with Escape');
assert.match(usageRender, /percentage points[\s\S]{0,80}90% to 95% is \+5 pp/i, 'Rate help must explain percentage points with an example');
assert.match(usageCss, /\.usage-metric-help\.is-open \.usage-metric-tooltip/, 'Analytics metric tooltips must have an explicit visible state');
assert.match(usageReact, /'aria-expanded': open \? 'true' : 'false'/, 'Analytics metric help must expose its expanded state to assistive technology');
assert.match(usageReact, /onClick: \(\) => setOpen\(value => !value\)/, 'Analytics metric help must support explicit touch and click toggling');
assert.match(charts, /event\.key === 'ArrowLeft'/, 'Analytics timeline must support keyboard period navigation');
assert.match(charts, /event\.key === 'ArrowRight'/, 'Analytics timeline must support keyboard period navigation');
assert.match(charts, /react-chartjs-2/, 'Analytics charts must use the canonical React Chart.js wrapper');
assert.match(charts, /chart\.js/, 'Analytics charts must use Chart.js instead of first-party SVG geometry');
assert.doesNotMatch(charts, /\bBar(?:Element)?\b/, 'Temporal analytics must use line charts consistently');
assert.match(charts, /spanGaps: false/, 'Missing rate and duration samples must remain visible as gaps');
assert.match(charts, /trailingGapContinuation/, 'Trailing idle buckets must keep the timeline visually connected to the range end');
assert.match(charts, /borderDash: \[4, 4\]/, 'Trailing idle continuation must be visually distinct from measured samples');
assert.match(usageCss, /\.usage-metric-value \{[^}]*flex-wrap/, 'Analytics metric values and deltas must wrap instead of overlapping neighboring tiles');
assert.ok(uiPackage.dependencies['chart.js'], 'Chart.js must be owned by the UI workspace');
assert.ok(uiPackage.dependencies['react-chartjs-2'], 'The React Chart.js wrapper must be owned by the UI workspace');
assert.doesNotMatch(`${usageReact}\n${homeReact}\n${workspacesReact}`, /h\(['"]svg['"]/, 'Analytics feature renderers must not retain first-party SVG chart markup');
assert.doesNotMatch(usageRender, /coordinates|polyline|area:\s*`/, 'Analytics view models must not retain first-party chart geometry');
assert.match(usageReact, /'aria-valuetext': valueText/, 'Analytics breakdown progress must expose readable values');
assert.match(usageCss, /\.usage-privacy-body/, 'Analytics privacy disclosure must use a stable responsive layout');

const currentMetricScope = {
  label: 'All projects', kind: 'all', usedMonthlyFallback: false,
  toolCalls: 10, reliabilityCalls: 10, reliableCalls: 9.68, reliabilityRate: 96.8,
  infrastructureFailures: 0, recoverableFailures: 0, failures: 1,
  completed: 10, operationSuccessRate: 92.7, averageDuration: 6120,
  points: [], tools: [], workspaces: [], failureCategories: []
};
const previousWithoutRateBaselines = {
  toolCalls: 0, reliabilityCalls: 0, reliableCalls: 0, reliabilityRate: 0,
  infrastructureFailures: 0, recoverableFailures: 0, completed: 0,
  operationSuccessRate: 0, averageDuration: 0
};
const noBaselineMetrics = analyticsMetrics(currentMetricScope, previousWithoutRateBaselines);
assert.equal(noBaselineMetrics.find(metric => metric.key === 'reliabilityRate')?.help.length > 0, true, 'Rate metrics must retain contextual help');
assert.equal(noBaselineMetrics.find(metric => metric.key === 'reliabilityRate')?.delta, null, 'A missing prior reliability baseline must not be displayed as a 0% comparison');
assert.equal(noBaselineMetrics.find(metric => metric.key === 'operationSuccessRate')?.delta, null, 'A missing prior success-rate baseline must not be displayed as a 0% comparison');

const comparedMetrics = analyticsMetrics(currentMetricScope, { ...previousWithoutRateBaselines, toolCalls: 10, reliabilityCalls: 10, reliableCalls: 9, reliabilityRate: 90, completed: 10, operationSuccessRate: 90, averageDuration: 7000 });
assert.equal(comparedMetrics.find(metric => metric.key === 'reliabilityRate')?.delta?.text, '+6.8 pp', 'Measured reliability rates must compare in percentage points');
assert.equal(comparedMetrics.find(metric => metric.key === 'operationSuccessRate')?.delta?.text, '+2.7 pp', 'Measured success rates must compare in percentage points');
const timeline = timelineModel([1, 3, 2], 'Actions');
assert.match(timeline.summary, /Peak 3/);
assert.match(timeline.summary, /Overall trend increasing/);
assert.equal(timeline.max, 3);
assert.equal(timeline.peakIndex, 1);
assert.equal(timeline.latestIndex, 2);
assert.deepEqual(timeline.data, [1, 3, 2]);
assert.equal('coordinates' in timeline, false);
assert.equal('points' in timeline, false);
assert.equal('area' in timeline, false);
const sparseRateTimeline = timelineModel([null, 100, null, 50], 'Successful actions');
assert.deepEqual(sparseRateTimeline.data, [null, 100, null, 50]);
assert.equal(sparseRateTimeline.peakIndex, 1);
assert.equal(sparseRateTimeline.latestIndex, 3);
assert.equal(pointMetric({ successes: 0, failures: 0 }, 'operationSuccessRate'), null, 'empty success-rate buckets must remain missing rather than becoming 0%');
assert.equal(pointMetric({ successes: 0, failures: 0, executionMs: 0 }, 'averageDuration'), null, 'empty duration buckets must remain missing rather than becoming 0 ms');
assert.equal(formatChartValue(null, 'Successful actions'), '—');

for (const label of ['Actions', 'Reliable actions', 'Internal errors', 'Retryable problems', 'Successful actions', 'Average time']) {
  assert.match(usageCombined, new RegExp(label), `Usage must render ${label}.`);
}
for (const field of ['requests', 'toolCalls', 'successes', 'failures', 'executionMs', 'activeDays']) {
  assert.match(usageCombined, new RegExp(`\\b${field}\\b`), `Analytics must consume ${field}.`);
}
assert.match(usageReact, /Analytics unavailable/);
assert.match(usageReact, /Retry/);
assert.match(usageReact, /Refresh/);
assert.match(usageRender, /operationSuccessRate/);
assert.match(usageRender, /recoverableFailures/);
assert.match(usageCombined, /Problems by type/);
assert.match(usageCombined, /Recent details are available in Troubleshooting/);
assert.doesNotMatch(usageRender, /Trend starts now|Completed outcomes|Workspace position|usage-fact-strip|<h3>Outcomes<\/h3>/);

const snapshot = buildUsageModel({
  ok: true,
  month: '2026-08',
  totals: { requests: 8, toolCalls: 5, successes: 4, failures: 1, executionMs: 5600, activeDays: 2 },
  tools: [{ tool: 'relai_read', toolCalls: 3, successes: 3, failures: 0, executionMs: 900 }],
  workspaces: [{ workspace: 'repo', toolCalls: 5, successes: 4, failures: 1, executionMs: 5600 }],
  failureCategories: [{ category: 'SENSITIVE_PATH_RESTRICTED', failures: 1 }]
}, '2026-08');
assert.equal('source' in snapshot, false);
assert.equal('devices' in snapshot, false);
assert.equal(snapshot.totals.toolCalls, 5);
assert.equal(snapshot.tools[0].tool, 'relai_read');
assert.deepEqual(snapshot.failureCategories, [{ category: 'runtime', failures: 1 }]);
assert.equal(currentUsageMonth(new Date('2026-08-08T00:00:00.000Z')), '2026-08');
assert.throws(() => buildUsageModel({ ok: true, month: '2026-08', totals: { requests: -1 } }), /Usage is unavailable|invalid value/);

const bounds = analyticsBounds('24h', { now: new Date('2026-08-08T12:00:00.000Z') });
assert.equal(bounds.start.toISOString(), '2026-08-07T12:00:00.000Z');
const ranged = analyticsRangeScope([buildUsageModel({
  ok: true,
  month: '2026-08',
  totals: { requests: 2, toolCalls: 2, successes: 1, failures: 1, executionMs: 100, activeDays: 1 },
  tools: [], workspaces: [],
  series: [{ hour: '2026-08-08T10', requests: 2, toolCalls: 2, successes: 1, failures: 1, executionMs: 100 }],
  toolSeries: [], workspaceSeries: [], workspaceToolSeries: [],
  failureCategorySeries: [{ hour: '2026-08-08T10', category: 'policy', failures: 1 }]
}, '2026-08')], bounds);
assert.equal(ranged.toolCalls, 2);
assert.equal(ranged.averageDuration, 50);
assert.deepEqual(ranged.failureCategories, [{ category: 'policy', failures: 1 }]);

const rollingHourBounds = analyticsBounds('1h', { now: new Date('2026-08-08T10:45:00.000Z') });
assert.equal(rollingHourBounds.start.toISOString(), '2026-08-08T10:00:00.000Z');
assert.equal(rollingHourBounds.end.toISOString(), '2026-08-08T11:00:00.000Z');
const rollingHour = analyticsRangeScope([buildUsageModel({
  ok: true,
  month: '2026-08',
  totals: { requests: 2, toolCalls: 2, successes: 2, failures: 0, executionMs: 20, activeDays: 1 },
  tools: [], workspaces: [],
  series: [
    { hour: '2026-08-08T09', requests: 1, toolCalls: 1, successes: 1, failures: 0, executionMs: 10 },
    { hour: '2026-08-08T10', requests: 1, toolCalls: 1, successes: 1, failures: 0, executionMs: 10 }
  ],
  toolSeries: [], workspaceSeries: [], workspaceToolSeries: []
}, '2026-08')], rollingHourBounds);
assert.equal(rollingHour.toolCalls, 1, 'one-hour analytics must represent the current UTC-hour bucket without pulling in the previous partial bucket');
assert.equal(rollingHour.points.reduce((sum, point) => sum + point.toolCalls, 0), 1, 'timeline totals must match the aligned UTC-hour range');

const loaded = await loadAnalyticsData({
  desktop: { getLocalUsage: async () => ({
    ok: true,
    month: '2026-08',
    privacy: { retentionDays: 180, externalTelemetry: { enabled: false, endpointConfigured: true, sampleRatio: 0.25 } },
    totals: { requests: 2, toolCalls: 2, successes: 2, failures: 0, executionMs: 120, activeDays: 1 },
    tools: [], workspaces: [{ workspace: 'repo', toolCalls: 2, successes: 2, failures: 0, executionMs: 120 }],
    workspaceTools: [],
    series: [{ hour: '2026-08-08T10', requests: 2, toolCalls: 2, successes: 2, failures: 0, executionMs: 120 }],
    toolSeries: [], workspaceSeries: [{ hour: '2026-08-08T10', workspace: 'repo', toolCalls: 2, successes: 2, failures: 0, executionMs: 120 }], workspaceToolSeries: []
  }) },
  range: '24h',
  now: new Date('2026-08-08T12:00:00.000Z')
});
assert.equal(loaded.current.toolCalls, 2);
assert.equal(loaded.current.workspaces[0].workspace, 'repo');
assert.deepEqual(loaded.privacy, {
  retentionDays: 180,
  externalTelemetry: { enabled: false, endpointConfigured: true, sampleRatio: 0.25 }
});

console.log('Local analytics UI and privacy contracts passed.');
