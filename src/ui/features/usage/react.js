import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postJson } from '../../api.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { Icon } from '../../components/icons.js';
import { toast } from '../../components/toast.js';
import { getRouteParams, getWorkspaceFilter, replaceRouteParams, routeHref } from '../../router.js';
import { ANALYTICS_RANGES, analyticsBounds, workspaceOptions } from './range-model.js';
import { loadAnalyticsData } from './data.js';
import { analyticsPrivacyCopy, customDateDefaults, rangeButtonLabel } from './index.js';
import { analyticsMetrics, duration, failureCategoryLabel, formatChartValue, integer, pointMetric, sparklineModel, timelineModel } from './render.js';

const h = React.createElement;
const USAGE_STORE_KEYS = Object.freeze(['live']);
const CHART_METRICS = Object.freeze([
  ['toolCalls', 'Actions', 'activity'],
  ['infrastructureFailures', 'System errors', 'warning'],
  ['operationSuccessRate', 'Successful actions', 'success'],
  ['averageDuration', 'Average time', 'timer']
]);
const METRIC_ICONS = Object.freeze({
  toolCalls: 'activity',
  reliabilityRate: 'reliability',
  infrastructureFailures: 'warning',
  recoverableFailures: 'refresh',
  operationSuccessRate: 'success',
  averageDuration: 'timer'
});

export function createUsageRoute(useDashboardSlices) {
  return function UsageRoute() {
    const { live } = useDashboardSlices(USAGE_STORE_KEYS);
    const params = useMemo(() => getRouteParams(), []);
    const requestedRange = params.get('range');
    const defaults = useMemo(() => customDateDefaults(), []);
    const [range, setRange] = useState(() => ANALYTICS_RANGES.some(([key]) => key === requestedRange) ? requestedRange : '24h');
    const [start, setStart] = useState(params.get('start') || defaults.start);
    const [end, setEnd] = useState(params.get('end') || defaults.end);
    const [workspace, setWorkspace] = useState(() => getWorkspaceFilter());
    const [loadState, setLoadState] = useState({ status: 'loading', message: '' });
    const [analytics, setAnalytics] = useState(null);
    const [refreshToken, setRefreshToken] = useState(0);
    const [clearing, setClearing] = useState(false);
    const [status, setStatus] = useState('Loading analytics…');
    const initialLoad = useRef(true);
    const loadingRef = useRef(false);
    const pendingLiveRefreshRef = useRef(false);
    const analyticsRef = useRef(null);
    const taskRevision = Number(live?.revisions?.task || 0);

    const load = useCallback(async ({ silent = false } = {}) => {
      if (loadingRef.current) {
        if (silent) pendingLiveRefreshRef.current = true;
        return;
      }
      loadingRef.current = true;
      let bounds;
      try {
        bounds = analyticsBounds(range, { customStart: start, customEnd: end });
      } catch (error) {
        loadingRef.current = false;
        setLoadState({ status: 'error', message: messageOf(error) });
        setStatus('Analytics could not be loaded.');
        return;
      }
      if (!silent) {
        setLoadState({ status: 'loading', message: '' });
        setStatus('Loading analytics…');
      }
      try {
        const result = await loadAnalyticsData({ desktop: window.relaiDesktop, bounds, workspace });
        analyticsRef.current = result;
        setAnalytics(result);
        setLoadState({ status: 'ready', message: '' });
        setStatus(`Analytics updated for ${bounds.label}.`);
      } catch (error) {
        if (!silent || !analyticsRef.current) setLoadState({ status: 'error', message: messageOf(error) });
        setStatus(silent ? 'Analytics could not be refreshed.' : 'Analytics could not be loaded.');
      } finally {
        loadingRef.current = false;
        if (pendingLiveRefreshRef.current) {
          pendingLiveRefreshRef.current = false;
          queueMicrotask(() => { void load({ silent: true }); });
        }
      }
    }, [range, start, end, workspace]);

    useEffect(() => {
      void load();
    }, [load, refreshToken]);

    useEffect(() => {
      if (initialLoad.current) {
        initialLoad.current = false;
        return undefined;
      }
      const timer = window.setTimeout(() => { void load({ silent: true }); }, 180);
      return () => window.clearTimeout(timer);
    }, [taskRevision]);

    useEffect(() => {
      const syncFromRoute = () => {
        const next = getRouteParams();
        const nextRange = next.get('range');
        setRange(ANALYTICS_RANGES.some(([key]) => key === nextRange) ? nextRange : '24h');
        setStart(next.get('start') || defaults.start);
        setEnd(next.get('end') || defaults.end);
        setWorkspace(getWorkspaceFilter());
      };
      window.addEventListener('hashchange', syncFromRoute);
      return () => window.removeEventListener('hashchange', syncFromRoute);
    }, [defaults]);

    const changeWorkspace = value => {
      setWorkspace(value);
      replaceRouteParams({ workspace: value || null, device: null });
    };
    const changeRange = value => {
      setRange(value);
      const custom = value === 'custom';
      replaceRouteParams({ range: value === '24h' ? null : value, start: custom ? start : null, end: custom ? end : null });
    };
    const changeDate = (key, value) => {
      if (key === 'start') setStart(value); else setEnd(value);
      if (range === 'custom') replaceRouteParams({ [key]: value });
    };
    const clearAnalytics = async () => {
      const confirmed = await confirmAction({
        title: 'Clear analytics',
        message: 'Clear local analytics history?',
        detail: 'This removes aggregate action, reliability, timing, project, and failure-category history. Project files, task history, memory, settings, and external telemetry configuration are not changed.',
        confirmLabel: 'Clear analytics',
        danger: true
      });
      if (!confirmed) return;
      setClearing(true);
      const result = await postJson('/api/diagnostics/reset', { target: 'analytics', confirm: true });
      setClearing(false);
      if (!result?.ok) {
        toast(result?.error || 'Local analytics could not be cleared.', { variant: 'error' });
        return;
      }
      toast(result.message || 'Local analytics cleared.', { variant: 'success' });
      setRefreshToken(value => value + 1);
    };

    const options = analytics ? workspaceOptions(analytics.models) : [];
    const selectedWorkspace = options.some(option => option.workspace === workspace) ? workspace : '';

    return h('div', { className: 'settings-content system-content', 'data-usage-react': 'true' },
      h('section', { className: 'usage-page', 'data-usage-page': true },
        h(AnalyticsToolbar, {
          end,
          loading: loadState.status === 'loading',
          onDateChange: changeDate,
          onRangeChange: changeRange,
          onRefresh: () => setRefreshToken(value => value + 1),
          onWorkspaceChange: changeWorkspace,
          options,
          range,
          selectedWorkspace,
          start
        }),
        h(PrivacyCard, { privacy: analytics?.privacy, clearing, onClear: clearAnalytics }),
        h('div', { className: 'sr-only', 'data-usage-status': true, role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, status),
        h('div', { className: 'usage-content', 'data-usage-content': true, 'aria-busy': loadState.status === 'loading' ? 'true' : undefined },
          loadState.status === 'loading' && !analytics
            ? h('div', { className: 'usage-loading' }, 'Loading analytics…')
            : loadState.status === 'error'
              ? h('section', { className: 'usage-unavailable empty-state', 'data-usage-unavailable': true },
                  h('strong', null, 'Analytics unavailable'), h('p', null, loadState.message || 'Analytics could not be loaded.'),
                  h('button', { type: 'button', className: 'secondary', 'data-usage-retry': true, onClick: () => setRefreshToken(value => value + 1) }, 'Retry')
                )
              : analytics ? h(UsageContent, { bounds: analytics.bounds, current: analytics.current, previous: analytics.previous }) : null
        )
      )
    );
  };
}

function AnalyticsToolbar({ end, loading, onDateChange, onRangeChange, onRefresh, onWorkspaceChange, options, range, selectedWorkspace, start }) {
  return h('div', { className: 'feature-toolbar usage-toolbar' },
    h('div', { className: 'usage-toolbar-heading' },
      h('div', { className: 'usage-title-row' }, h(Icon, { name: 'usage', size: 20 }), h('h2', null, 'Analytics')),
      h('p', null, 'Analytics are stored on this computer. Prompts, file paths, command output, and action results are not stored.')
    ),
    h('div', { className: 'usage-toolbar-controls' },
      h('label', { className: 'usage-workspace-control' },
        h('span', null, 'Project'),
        h('select', { 'data-usage-workspace': true, value: selectedWorkspace, onChange: event => onWorkspaceChange(event.target.value) },
          h('option', { value: '' }, 'All projects'),
          options.map(option => h('option', { key: option.workspace, value: option.workspace }, option.workspace))
        )
      ),
      h('div', { className: 'usage-range-control' },
        h('span', null, 'Range'),
        h('select', { 'data-usage-range': true, hidden: true, value: range, onChange: event => onRangeChange(event.target.value) },
          ANALYTICS_RANGES.map(([key, label]) => h('option', { key, value: key }, label))
        ),
        h('div', { className: 'usage-range-switch', role: 'group', 'aria-label': 'Analytics range' },
          ANALYTICS_RANGES.map(([key, label]) => h('button', {
            key,
            type: 'button',
            'data-usage-range-option': key,
            'aria-label': label,
            title: label,
            'aria-pressed': range === key ? 'true' : 'false',
            onClick: () => onRangeChange(key)
          }, rangeButtonLabel(key, label)))
        )
      ),
      h('div', { className: 'usage-custom-range', 'data-usage-custom-range': true, hidden: range !== 'custom' },
        h('label', null, h('span', null, 'From'), h('input', { type: 'date', 'data-usage-start': true, value: start, onChange: event => onDateChange('start', event.target.value) })),
        h('label', null, h('span', null, 'To'), h('input', { type: 'date', 'data-usage-end': true, value: end, onChange: event => onDateChange('end', event.target.value) }))
      ),
      h('button', {
        type: 'button',
        className: 'secondary usage-toolbar-refresh',
        'data-usage-refresh': true,
        disabled: loading,
        onClick: onRefresh
      }, h(Icon, { name: 'refresh', className: loading ? 'is-spinning' : '' }), h('span', null, loading ? 'Loading…' : 'Refresh'))
    )
  );
}

function PrivacyCard({ privacy, clearing, onClear }) {
  if (!privacy) return h('div', { 'data-usage-privacy': true });
  const copy = analyticsPrivacyCopy(privacy);
  return h('div', { 'data-usage-privacy': true },
    h('section', { className: 'card usage-privacy-card', 'aria-label': 'Analytics privacy' },
      h('div', { className: 'card-body usage-privacy-body' },
        h('div', { className: 'usage-privacy-copy' },
          h('strong', { className: 'usage-privacy-title' }, h(Icon, { name: 'reliability', size: 17 }), h('span', null, 'Data & privacy')),
          h('span', null, copy.retention),
          h('span', null, copy.telemetry)
        ),
        h('button', { type: 'button', className: 'secondary danger', 'data-usage-clear': true, disabled: clearing, onClick: () => { void onClear(); } }, clearing ? 'Clearing…' : 'Clear analytics')
      )
    )
  );
}

function UsageContent({ bounds, current, previous }) {
  const [chartKey, setChartKey] = useState('toolCalls');
  const chart = CHART_METRICS.find(([key]) => key === chartKey) || CHART_METRICS[0];
  const fallback = current.usedMonthlyFallback && current.points.every(point => point.toolCalls === 0 && point.requests === 0);
  return h(React.Fragment, null,
    h('section', { className: 'usage-overview', 'aria-label': `${current.label} analytics for ${bounds.label}` },
      fallback ? h('p', { className: 'usage-series-note' }, 'Hourly trends are unavailable for older monthly totals.') : null,
      h('div', { className: 'usage-metrics' }, analyticsMetrics(current, previous).map(metric => h(Metric, { key: metric.key, metric })))
    ),
    h('section', { className: 'card usage-timeline-card', 'data-usage-timeline': true },
      h('div', { className: 'card-head usage-timeline-head' },
        h('div', { className: 'usage-card-title' }, h(Icon, { name: 'activity', size: 17 }), h('h3', null, 'Activity')),
        h('div', { className: 'usage-chart-switch', role: 'group', 'aria-label': 'Chart metric' }, CHART_METRICS.map(([key, label, icon]) => h('button', {
          key,
          type: 'button',
          className: `secondary compact-button${chartKey === key ? ' active' : ''}`,
          'data-usage-chart': key,
          'aria-pressed': chartKey === key ? 'true' : 'false',
          onClick: () => setChartKey(key)
        }, h(Icon, { name: icon, size: 15 }), h('span', null, label))))
      ),
      h('div', { className: 'card-body usage-timeline-body', 'data-usage-chart-body': true },
        h(Timeline, { bounds, points: current.points, metricKey: chart[0], label: chart[1] })
      )
    ),
    h(ActivityBars, { title: 'Actions by tool', rows: current.tools, kind: 'tool' }),
    current.kind === 'workspace'
      ? h(React.Fragment, null,
          h(FailureCategories, { rows: current.failureCategories, totalFailures: current.failures }),
          h(Breakdown, { title: 'Devices', rows: current.devices, kind: 'device' })
        )
      : h('div', { className: 'usage-side-by-side' },
          h(FailureCategories, { rows: current.failureCategories, totalFailures: current.failures }),
          h(ActivityBars, { title: 'Project activity', rows: current.workspaces, kind: 'workspace' })
        )
  );
}

function Metric({ metric }) {
  const [open, setOpen] = useState(false);
  const helpId = `usage-metric-help-${metric.key}`;
  const spark = sparklineModel(metric.values);
  return h('article', { className: `usage-metric ${metric.tone}${open ? ' help-open' : ''}`.trim() },
    h('div', { className: 'usage-metric-label-row' },
      h('span', { className: 'usage-metric-label-main' },
        h(Icon, { name: METRIC_ICONS[metric.key] || 'usage', className: 'usage-metric-icon', size: 16 }),
        h('span', { className: 'usage-metric-label' }, metric.label)
      ),
      metric.help ? h('span', {
        className: `usage-metric-help${open ? ' is-open' : ''}`,
        onPointerEnter: () => setOpen(true),
        onPointerLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false)
      },
        h('button', {
          type: 'button',
          className: 'usage-metric-help-trigger',
          'aria-label': `About ${metric.label}`,
          'aria-describedby': helpId,
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen(value => !value),
          onKeyDown: event => {
            if (event.key === 'Escape') {
              setOpen(false);
              event.stopPropagation();
            }
          }
        }, h(Icon, { name: 'help', size: 17 })),
        h('span', { id: helpId, role: 'tooltip', className: 'usage-metric-tooltip' }, metric.help)
      ) : null
    ),
    h('div', { className: 'usage-metric-value' },
      h('strong', null, metric.value),
      metric.delta ? h('small', { className: `usage-delta ${metric.delta.tone || ''}`.trim() }, metric.delta.text) : null
    ),
    metric.detail ? h('small', { className: 'usage-metric-detail' }, metric.detail) : null,
    spark ? h('svg', { className: `usage-sparkline ${metric.tone}`.trim(), viewBox: `0 0 ${spark.width} ${spark.height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
      h('polyline', { points: spark.points, fill: 'none', vectorEffect: 'non-scaling-stroke' })
    ) : h('span', { className: 'usage-sparkline-empty', 'aria-hidden': 'true' })
  );
}

function Timeline({ bounds, points = [], metricKey, label }) {
  const values = points.map(point => pointMetric(point, metricKey));
  const model = timelineModel(values, label);
  const signature = `${metricKey}:${values.join('|')}`;
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, model.latestIndex || 0));

  useEffect(() => {
    setActiveIndex(Math.max(0, model.latestIndex || 0));
  }, [signature, model.latestIndex]);

  if (model.empty) return h('div', { className: 'usage-chart-empty' }, 'No activity in this range.');

  const safeIndex = Math.max(0, Math.min(model.latestIndex, activeIndex));
  const active = model.coordinates[safeIndex];
  const peak = model.coordinates[model.peakIndex];
  const latest = model.coordinates[model.latestIndex];
  const point = points[safeIndex];
  const readoutId = `usage-chart-readout-${metricKey}`;
  const selectedTime = formatPointTime(point, bounds, true);
  const selectedValue = formatChartValue(active.value, label);
  const peakValue = formatChartValue(model.peak, label);
  const tickIndexes = timelineTickIndexes(points.length);

  const selectFromPointer = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setActiveIndex(Math.round(ratio * model.latestIndex));
  };
  const onKeyDown = event => {
    let next = null;
    if (event.key === 'ArrowLeft') next = Math.max(0, safeIndex - 1);
    else if (event.key === 'ArrowRight') next = Math.min(model.latestIndex, safeIndex + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End' || event.key === 'Escape') next = model.latestIndex;
    if (next == null) return;
    event.preventDefault();
    setActiveIndex(next);
  };

  return h('div', { className: 'usage-timeline-plot' },
    h('div', { className: 'usage-chart-readout', id: readoutId },
      h('span', null, selectedTime),
      h('strong', null, selectedValue),
      h('small', null, safeIndex === model.peakIndex ? 'Peak in this range' : `Peak ${peakValue}`)
    ),
    h('div', { className: 'usage-timeline-stage' },
      h('div', { className: 'usage-chart-y-axis', 'aria-hidden': 'true' },
        h('span', null, formatChartValue(model.max, label)),
        h('span', null, formatChartValue(0, label))
      ),
      h('svg', {
        className: 'usage-timeline-svg',
        viewBox: `0 0 ${model.width} ${model.height}`,
        preserveAspectRatio: 'none',
        role: 'group',
        tabIndex: 0,
        'aria-label': `${model.summary} Use Left and Right Arrow keys to inspect periods. Home selects the first period and End selects the latest.`,
        'aria-describedby': readoutId,
        onPointerMove: selectFromPointer,
        onPointerLeave: () => setActiveIndex(model.latestIndex),
        onFocus: () => setActiveIndex(index => Number.isInteger(index) ? index : model.latestIndex),
        onBlur: () => setActiveIndex(model.latestIndex),
        onKeyDown
      },
        [0.28, 0.52, 0.76].map(ratio => h('line', { key: ratio, x1: 0, y1: model.height * ratio, x2: model.width, y2: model.height * ratio, className: 'usage-chart-grid' })),
        h('polygon', { points: model.area, className: 'usage-chart-area' }),
        h('line', { x1: 0, y1: model.baseline, x2: model.width, y2: model.baseline, className: 'usage-chart-axis' }),
        h('polyline', { points: model.points, className: 'usage-chart-line', fill: 'none', vectorEffect: 'non-scaling-stroke' }),
        peak ? h('circle', { cx: peak.x, cy: peak.y, r: 4, className: 'usage-chart-point peak', 'aria-hidden': 'true' }) : null,
        latest ? h('circle', { cx: latest.x, cy: latest.y, r: 3.5, className: 'usage-chart-point latest', 'aria-hidden': 'true' }) : null,
        h('line', { x1: active.x, y1: 8, x2: active.x, y2: model.baseline, className: 'usage-chart-crosshair', 'aria-hidden': 'true' }),
        h('circle', { cx: active.x, cy: active.y, r: 5, className: 'usage-chart-point active', 'aria-hidden': 'true' })
      )
    ),
    h('div', { className: 'usage-timeline-scale', 'aria-hidden': 'true' },
      tickIndexes.map(index => h('span', { key: index }, formatPointTime(points[index], bounds, false)))
    ),
    h('div', { className: 'usage-chart-hint' }, 'Hover the chart or focus it and use ← / → to inspect exact values. Times are UTC.')
  );
}

function FailureCategories({ rows = [], totalFailures = 0 }) {
  const visible = [...rows].sort((a, b) => b.failures - a.failures).slice(0, 10);
  const max = Math.max(1, ...visible.map(row => row.failures));
  return h('section', { className: 'card usage-breakdown usage-bar-card' },
    h('div', { className: 'card-head' },
      h('div', null, h('h3', null, 'What went wrong'), h('p', null, 'Detailed error messages are not stored.'))
    ),
    h('div', { className: 'card-body' }, visible.length
      ? h('div', { className: 'usage-bar-list' }, visible.map(row => h(BarRow, {
          key: row.category,
          label: failureCategoryLabel(row.category),
          value: row.failures,
          max,
          unit: 'failure'
        })))
      : h('div', { className: 'usage-breakdown-empty' }, Number(totalFailures || 0) > 0 ? 'Problem types are unavailable for older data.' : 'No failures in this range.'))
  );
}

function ActivityBars({ title, rows = [], kind }) {
  const visible = [...rows].sort((a, b) => b.toolCalls - a.toolCalls).slice(0, 10);
  const max = Math.max(1, ...visible.map(row => row.toolCalls));
  return h('section', { className: 'card usage-breakdown usage-bar-card' },
    h('div', { className: 'card-head' }, h('h3', null, title)),
    h('div', { className: 'card-body' }, visible.length
      ? h('div', { className: 'usage-bar-list' }, visible.map((row, index) => {
          const label = kind === 'workspace' ? (row.workspace || 'Unattributed') : (row.tool || 'Unknown tool');
          const drilldown = kind === 'workspace' && Boolean(row.workspace);
          const inner = h(BarRowContent, { label, value: row.toolCalls, max, unit: 'action', drilldown });
          return drilldown
            ? h('a', {
                key: row.workspace,
                className: 'usage-bar-row usage-bar-link',
                href: routeHref('usage', { workspace: row.workspace }),
                'aria-label': `View analytics for ${row.workspace}`,
                title: `View analytics for ${row.workspace}`
              }, inner)
            : h('div', { key: `${label}-${index}`, className: 'usage-bar-row' }, inner);
        }))
      : h('div', { className: 'usage-breakdown-empty' }, 'No activity in this range.'))
  );
}

function BarRow({ label, value, max, unit = 'action' }) {
  return h('div', { className: 'usage-bar-row' }, h(BarRowContent, { label, value, max, unit }));
}

function BarRowContent({ label, value, max, unit = 'action', drilldown = false }) {
  const valueText = `${integer(value)} ${Number(value) === 1 ? unit : `${unit}s`}`;
  return h(React.Fragment, null,
    h('span', { className: 'usage-bar-label', title: label }, label),
    h('progress', { max, value, 'aria-label': `${label}: ${valueText}`, 'aria-valuetext': valueText }, integer(value)),
    h('strong', { className: 'usage-bar-value' }, h('span', null, integer(value)), drilldown ? h(Icon, { name: 'chevronRight', size: 15 }) : null)
  );
}

function Breakdown({ title, rows = [], kind }) {
  return h('section', { className: 'card usage-breakdown' },
    h('div', { className: 'card-head' }, h('h3', null, title)),
    h('div', { className: 'card-body' }, rows.length
      ? h('div', { className: 'usage-table-wrap' }, h('table', { className: 'usage-table' },
          h('thead', null, h('tr', null,
            h('th', { scope: 'col' }, title.slice(0, -1)),
            h('th', { scope: 'col' }, 'Actions'),
            h('th', { scope: 'col' }, 'Successful'),
            h('th', { scope: 'col' }, 'Failed'),
            h('th', { scope: 'col' }, 'Total execution time')
          )),
          h('tbody', null, rows.map((row, index) => {
            const label = kind === 'device' ? (row.displayName || shortId(row.deviceId) || 'Unknown device') : (row[kind] || 'Unknown');
            return h('tr', { key: `${label}-${index}` },
              h('th', { scope: 'row' }, label),
              h('td', null, integer(row.toolCalls)),
              h('td', null, integer(row.successes)),
              h('td', null, integer(row.failures)),
              h('td', null, duration(row.executionMs))
            );
          }))
        ))
      : h('div', { className: 'usage-breakdown-empty' }, 'No activity in this range.'))
  );
}

function timelineTickIndexes(length) {
  if (length <= 1) return [0];
  return [...new Set([0, Math.floor((length - 1) / 2), length - 1])];
}

function formatPointTime(point, bounds, detailed) {
  const at = Number(point?.at);
  if (!Number.isFinite(at)) return detailed ? 'Selected period' : '—';
  const date = new Date(at);
  const span = Math.max(0, Number(bounds?.end?.getTime?.() || 0) - Number(bounds?.start?.getTime?.() || 0));
  const options = detailed
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }
    : span <= 2 * 24 * 60 * 60 * 1000
      ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }
      : span <= 32 * 24 * 60 * 60 * 1000
        ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
        : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function shortId(value) {
  const text = String(value || '');
  return text.length > 12 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Analytics unavailable.');
}
