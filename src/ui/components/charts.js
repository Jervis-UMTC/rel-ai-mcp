import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from 'chart.js';
import { color as chartColor } from 'chart.js/helpers';
import { Line } from 'react-chartjs-2';
import { COLOR_THEMES } from '../colorTokens.mjs';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip);

const h = React.createElement;
const DEFAULT_THEME = Object.freeze({
  action: COLOR_THEMES.light.actionPrimary,
  border: COLOR_THEMES.light.borderSubtle,
  borderDefault: COLOR_THEMES.light.borderDefault,
  text: COLOR_THEMES.light.textSecondary,
  textMuted: COLOR_THEMES.light.textTertiary,
  surface: COLOR_THEMES.light.surfacePrimary,
  raised: COLOR_THEMES.light.surfaceRaised,
  success: COLOR_THEMES.light.statusSuccessForeground,
  danger: COLOR_THEMES.light.statusDangerForeground,
  warning: COLOR_THEMES.light.statusWarningForeground,
  reducedMotion: false
});

export function SparkChart({ values = [], className = '', tone = '', ariaLabel = '', decorative = true }) {
  const data = safeValues(values);
  const theme = useChartTheme();
  const accent = toneColor(theme, tone);
  const chartData = useMemo(() => ({
    labels: data.map((_, index) => String(index + 1)),
    datasets: [{
      data,
      borderColor: accent,
      backgroundColor: withAlpha(accent, 0.08),
      borderWidth: 1.5,
      cubicInterpolationMode: 'monotone',
      tension: 0.32,
      fill: true,
      spanGaps: true,
      pointRadius: 0,
      pointHoverRadius: 0
    }]
  }), [accent, data]);
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    events: [],
    layout: { padding: 0 },
    plugins: { tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { display: false, beginAtZero: true }
    }
  }), []);
  if (!data.some(value => value !== null)) return null;
  return h('div', { className }, h(Line, {
    data: chartData,
    options,
    role: decorative ? undefined : 'img',
    'aria-hidden': decorative ? 'true' : undefined,
    'aria-label': decorative ? undefined : ariaLabel
  }));
}

export function AnalyticsTimelineChart({
  values = [],
  labels = [],
  detailedLabels = [],
  className = '',
  ariaLabel = '',
  ariaDescribedBy = '',
  valueLabel = 'Value',
  formatValue = value => String(value),
  peakIndex = -1,
  activeIndex = 0,
  onActiveIndexChange = () => {}
}) {
  const data = safeValues(values);
  const theme = useChartTheme();
  const chartRef = useRef(null);
  const latestIndex = Math.max(0, lastDefinedIndex(data));
  const accent = theme.action;
  const trailingData = trailingGapContinuation(data);
  const chartData = useMemo(() => ({
    labels,
    datasets: [{
      data,
      borderColor: accent,
      backgroundColor: withAlpha(accent, 0.08),
      borderWidth: 2,
      cubicInterpolationMode: 'monotone',
      tension: 0.34,
      fill: true,
      spanGaps: false,
      pointRadius: context => context.dataIndex === peakIndex ? 3 : 0,
      pointHoverRadius: 4,
      pointHitRadius: 10,
      pointBackgroundColor: context => context.dataIndex === peakIndex ? theme.warning : accent,
      pointBorderColor: theme.surface,
      pointBorderWidth: 2
    }, ...(trailingData ? [{
      data: trailingData,
      borderColor: withAlpha(accent, 0.5),
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [4, 4],
      tension: 0,
      fill: false,
      spanGaps: true,
      pointRadius: 0,
      pointHoverRadius: 0,
      pointHitRadius: 0
    }] : [])]
  }), [accent, data, labels, peakIndex, theme.surface, theme.warning, trailingData]);
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: theme.reducedMotion ? false : { duration: 180 },
    interaction: { intersect: false, mode: 'index' },
    layout: { padding: { top: 8, right: 4, bottom: 0, left: 0 } },
    onHover: (_event, elements) => {
      const index = elements?.find(item => item.datasetIndex === 0)?.index;
      if (Number.isInteger(index)) onActiveIndexChange(index);
    },
    plugins: {
      tooltip: {
        enabled: true,
        displayColors: false,
        backgroundColor: theme.raised,
        borderColor: theme.borderDefault,
        borderWidth: 1,
        titleColor: theme.text,
        bodyColor: theme.text,
        padding: 9,
        filter: item => item.datasetIndex === 0,
        callbacks: {
          title: items => detailedLabels[items?.[0]?.dataIndex] || labels[items?.[0]?.dataIndex] || '',
          label: context => `${valueLabel}: ${formatValue(context.raw == null ? null : Number(context.raw))}`
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: theme.borderDefault },
        ticks: {
          color: theme.textMuted,
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 3,
          font: { size: 10, weight: 600 }
        }
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: theme.border, lineWidth: 1 },
        ticks: {
          color: theme.textMuted,
          maxTicksLimit: 4,
          padding: 8,
          font: { size: 10, weight: 600 },
          callback: value => formatValue(Number(value) || 0)
        }
      }
    }
  }), [detailedLabels, formatValue, labels, onActiveIndexChange, theme, valueLabel]);

  useEffect(() => {
    activateChartIndex(chartRef.current, activeIndex);
  }, [activeIndex, chartData, options]);

  const selectIndex = index => {
    const next = Math.max(0, Math.min(latestIndex, index));
    onActiveIndexChange(next);
    activateChartIndex(chartRef.current, next);
  };
  const onKeyDown = event => {
    let next = null;
    if (event.key === 'ArrowLeft') next = activeIndex - 1;
    else if (event.key === 'ArrowRight') next = activeIndex + 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End' || event.key === 'Escape') next = latestIndex;
    if (next === null) return;
    event.preventDefault();
    selectIndex(next);
  };

  return h('div', {
    className,
    role: 'group',
    tabIndex: 0,
    'aria-label': `${ariaLabel} Use Left and Right Arrow keys to inspect periods. Home selects the first period and End selects the latest.`,
    'aria-describedby': ariaDescribedBy || undefined,
    onFocus: () => selectIndex(Number.isInteger(activeIndex) ? activeIndex : latestIndex),
    onBlur: () => selectIndex(latestIndex),
    onPointerLeave: () => selectIndex(latestIndex),
    onKeyDown
  },
  h(Line, { ref: chartRef, data: chartData, options, 'aria-hidden': 'true' }),
  h(AccessibleChartTable, { labels: detailedLabels.length ? detailedLabels : labels, values: data, valueLabel, formatValue }));
}

function AccessibleChartTable({ labels, values, valueLabel, formatValue }) {
  return h('table', { className: 'sr-only' },
    h('caption', null, 'Chart data'),
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Time'), h('th', { scope: 'col' }, valueLabel))),
    h('tbody', null, values.map((value, index) => h('tr', { key: `${index}-${labels[index] || ''}` },
      h('td', null, labels[index] || `Period ${index + 1}`),
      h('td', null, formatValue(value))
    )))
  );
}

function activateChartIndex(chart, index) {
  if (!chart || !Number.isInteger(index) || index < 0) return;
  const element = chart.getDatasetMeta?.(0)?.data?.[index];
  if (!element) return;
  const active = [{ datasetIndex: 0, index }];
  chart.setActiveElements?.(active);
  chart.tooltip?.setActiveElements?.(active, { x: element.x, y: element.y });
  chart.update?.('none');
}

function useChartTheme() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const refresh = () => setRevision(value => value + 1);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(refresh) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = typeof matchMedia === 'function'
      ? [matchMedia('(prefers-color-scheme: dark)'), matchMedia('(prefers-reduced-motion: reduce)'), matchMedia('(forced-colors: active)')]
      : [];
    for (const query of media) query.addEventListener?.('change', refresh);
    return () => {
      observer?.disconnect();
      for (const query of media) query.removeEventListener?.('change', refresh);
    };
  }, []);
  return useMemo(() => readChartTheme(), [revision]);
}

function readChartTheme() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return DEFAULT_THEME;
  const styles = getComputedStyle(document.documentElement);
  const token = (name, fallback) => String(styles.getPropertyValue(name) || '').trim() || fallback;
  return {
    action: token('--ui-action-primary', DEFAULT_THEME.action),
    border: token('--ui-border-subtle', DEFAULT_THEME.border),
    borderDefault: token('--ui-border-default', DEFAULT_THEME.borderDefault),
    text: token('--ui-text-secondary', DEFAULT_THEME.text),
    textMuted: token('--ui-text-tertiary', DEFAULT_THEME.textMuted),
    surface: token('--ui-surface-primary', DEFAULT_THEME.surface),
    raised: token('--ui-surface-raised', DEFAULT_THEME.raised),
    success: token('--ui-status-success-foreground', DEFAULT_THEME.success),
    danger: token('--ui-status-danger-foreground', DEFAULT_THEME.danger),
    warning: token('--ui-status-warning-foreground', DEFAULT_THEME.warning),
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  };
}

function toneColor(theme, tone) {
  if (tone === 'good') return theme.success;
  if (tone === 'bad') return theme.danger;
  return theme.action;
}

function safeValues(values) {
  return (Array.isArray(values) ? values : []).map(value => {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  });
}

function lastDefinedIndex(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) if (values[index] !== null) return index;
  return -1;
}

function trailingGapContinuation(values) {
  const last = lastDefinedIndex(values);
  if (last < 0 || last >= values.length - 1) return null;
  const continuation = new Array(values.length).fill(null);
  continuation[last] = values[last];
  continuation[values.length - 1] = values[last];
  return continuation;
}

function withAlpha(color, alpha) {
  const parsed = chartColor(color);
  return parsed.valid ? parsed.alpha(alpha).rgbString() : color;
}
