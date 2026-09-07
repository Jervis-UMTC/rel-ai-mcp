import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip);

const h = React.createElement;
const DEFAULT_THEME = Object.freeze({
  action: '#657f00',
  border: '#dce3ec',
  borderDefault: '#cbd5e1',
  text: '#475569',
  textMuted: '#64748b',
  surface: '#ffffff',
  raised: '#e8eef6',
  success: '#15803d',
  danger: '#b91c1c',
  warning: '#a16207',
  reducedMotion: false
});

export function SparkChart({ values = [], className = '', mode = 'line', tone = '', ariaLabel = '', decorative = true }) {
  const data = safeValues(values);
  const theme = useChartTheme();
  const accent = toneColor(theme, tone);
  const Component = mode === 'bar' ? Bar : Line;
  const chartData = useMemo(() => ({
    labels: data.map((_, index) => String(index + 1)),
    datasets: [mode === 'bar'
      ? {
          data,
          backgroundColor: withAlpha(accent, 0.3),
          borderColor: accent,
          borderWidth: 1,
          borderRadius: 3,
          borderSkipped: false,
          barPercentage: 0.72,
          categoryPercentage: 0.86
        }
      : {
          data,
          borderColor: accent,
          backgroundColor: withAlpha(accent, 0.08),
          borderWidth: 1.5,
          cubicInterpolationMode: 'monotone',
          tension: 0.32,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 0
        }]
  }), [accent, data, mode]);
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
  if (!data.length) return null;
  return h('div', { className }, h(Component, {
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
  mode = 'line',
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
  const Component = mode === 'bar' ? Bar : Line;
  const latestIndex = Math.max(0, data.length - 1);
  const accent = theme.action;
  const chartData = useMemo(() => ({
    labels,
    datasets: [mode === 'bar'
      ? {
          data,
          backgroundColor: withAlpha(accent, 0.28),
          hoverBackgroundColor: withAlpha(accent, 0.48),
          borderColor: context => context.dataIndex === peakIndex ? theme.warning : accent,
          borderWidth: context => context.dataIndex === peakIndex ? 2 : 1,
          borderRadius: 5,
          borderSkipped: false,
          maxBarThickness: 30,
          barPercentage: 0.72,
          categoryPercentage: 0.88
        }
      : {
          data,
          borderColor: accent,
          backgroundColor: withAlpha(accent, 0.08),
          borderWidth: 2,
          cubicInterpolationMode: 'monotone',
          tension: 0.34,
          fill: true,
          pointRadius: context => context.dataIndex === peakIndex ? 3 : 0,
          pointHoverRadius: 4,
          pointHitRadius: 10,
          pointBackgroundColor: context => context.dataIndex === peakIndex ? theme.warning : accent,
          pointBorderColor: theme.surface,
          pointBorderWidth: 2
        }]
  }), [accent, data, labels, mode, peakIndex, theme.surface, theme.warning]);
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: theme.reducedMotion ? false : { duration: 180 },
    interaction: { intersect: false, mode: 'index' },
    layout: { padding: { top: 8, right: 4, bottom: 0, left: 0 } },
    onHover: (_event, elements) => {
      const index = elements?.[0]?.index;
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
        callbacks: {
          title: items => detailedLabels[items?.[0]?.dataIndex] || labels[items?.[0]?.dataIndex] || '',
          label: context => `${valueLabel}: ${formatValue(Number(context.raw) || 0)}`
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
  h(Component, { ref: chartRef, data: chartData, options, 'aria-hidden': 'true' }),
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
  return (Array.isArray(values) ? values : []).map(Number).map(value => Number.isFinite(value) && value >= 0 ? value : 0);
}

function withAlpha(color, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const red = value >> 16 & 255;
  const green = value >> 8 & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
