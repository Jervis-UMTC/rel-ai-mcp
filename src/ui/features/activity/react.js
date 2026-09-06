import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { flushSync } from 'react-dom';
import { fetchJson } from '../../api.js';
import { filterRadioField, filterSelectField, openFilterDrawer } from '../../components/filter-drawer.js';
import { Icon } from '../../components/icons.js';
import { pillClass } from '../../components/pill.js';
import { statusTone } from '../../status-tone.js';
import { toast } from '../../components/toast.js';
import { copyText } from '../../clipboard.js';
import { getRouteParams, getWorkspaceFilter, navigate, replaceRouteParams, routeHref } from '../../router.js';
import { timeAgo } from '../../utils.js';
import { activityEventId } from '../../activity-event.js';
import { eventTimestampValue } from '../../../taskEvents.js';
import {
  activityAbsoluteTime,
  activityActionLabel,
  activityDisplayAction,
  activityFilterTransition,
  activityMessage,
  activitySessionView,
  activityStatusGroup,
  activityToolLabel,
  filterActivityEntries,
  mergeActivityEntries,
  nextActivityExpiry,
  parseActivityHistoryResponse,
  replaceActivityHistory
} from './model.js';

const h = React.createElement;
const ACTIVITY_STORE_KEYS = Object.freeze(['auditTail', 'tasks']);
const EMPTY_FILTERS = Object.freeze({ search: '', timeRange: '1h', workspace: '', tool: '', status: '', task: '' });
const TIME_OPTIONS = Object.freeze([
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'all', label: 'All time' }
]);
const STATUS_OPTIONS = Object.freeze([
  { value: '', label: 'All statuses' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'active', label: 'In progress' },
  { value: 'failed', label: 'Failed' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'other', label: 'Other' }
]);

export function createActivityRoute(useDashboardSlices) {
  return function ActivityRoute() {
    const data = useDashboardSlices(ACTIVITY_STORE_KEYS);
    return h(ActivityView, { data });
  };
}

function ActivityView({ data = {} }) {
  const initialRoute = useMemo(readRouteState, []);
  const [filterState, setFilterState] = useState(initialRoute.filters);
  const [requestedEventId, setRequestedEventId] = useState(initialRoute.eventId);
  const [allEntries, setAllEntries] = useState(() => replaceActivityHistory(data.auditTail?.entries || []));
  const [paused, setPaused] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedEventId, setSelectedEventId] = useState(initialRoute.eventId);
  const [now, setNow] = useState(() => Date.now());
  const [copyState, setCopyState] = useState('idle');
  const allEntriesRef = useRef(allEntries);
  const pausedRef = useRef(paused);
  const pausedEntriesRef = useRef([]);
  const liveEntriesSinceLoadRef = useRef([]);
  const historyLoadingRef = useRef(true);
  const historyRequestRef = useRef(0);
  const historyRetryRef = useRef(false);
  const nextExpiryRef = useRef(Number.POSITIVE_INFINITY);
  const searchTimerRef = useRef(0);
  const copyTimerRef = useRef(0);
  const inspectorHeadingRef = useRef(null);
  const tableWrapRef = useRef(null);
  const selectionFocusRef = useRef(false);

  useEffect(() => { allEntriesRef.current = allEntries; }, [allEntries]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { historyLoadingRef.current = historyLoading; }, [historyLoading]);

  const sessionIndex = useMemo(() => buildSessionIndex(data.tasks), [data.tasks]);
  const filterOptions = useMemo(() => ({
    workspaces: uniqueValues(allEntries, entry => entry.workspace),
    tools: uniqueValues(allEntries, toolName)
  }), [allEntries]);
  const filteredEntries = useMemo(() => filterActivityEntries(allEntries, filterState, now, {
    sorted: true,
    sessionTitle: entry => activitySessionView(entry, sessionIndex).title
  }), [allEntries, filterState, now, sessionIndex]);
  const selectedEntry = useMemo(
    () => allEntries.find(entry => activityEventId(entry) === selectedEventId) || null,
    [allEntries, selectedEventId]
  );
  const activeFilters = useMemo(
    () => activityFilters(filterState, sessionIndex),
    [filterState, sessionIndex]
  );

  useEffect(() => {
    nextExpiryRef.current = nextActivityExpiry(allEntries, filterState, now);
  }, [allEntries, filterState, now]);

  const mergeIntoVisibleEntries = useCallback(entries => {
    if (!Array.isArray(entries) || entries.length === 0) return false;
    const current = allEntriesRef.current;
    const merged = mergeActivityEntries(current, entries);
    if (!merged.changed) return false;
    allEntriesRef.current = merged.entries;
    setAllEntries(merged.entries);
    return true;
  }, []);

  const loadHistory = useCallback(async mode => {
    const requestId = ++historyRequestRef.current;
    try {
      const response = await fetchJson('/api/logs?limit=500', { pauseTimeoutWhenHidden: false });
      if (requestId !== historyRequestRef.current) return false;
      const parsed = parseActivityHistoryResponse(response);
      if (!parsed.ok) throw new Error(parsed.error);
      if (mode === 'replace') {
        const stored = replaceActivityHistory(parsed.entries);
        const merged = mergeActivityEntries(stored, liveEntriesSinceLoadRef.current).entries;
        liveEntriesSinceLoadRef.current = [];
        allEntriesRef.current = merged;
        setAllEntries(merged);
      } else {
        mergeIntoVisibleEntries(parsed.entries);
      }
      historyRetryRef.current = false;
      historyLoadingRef.current = false;
      setHistoryLoading(false);
      setLoadError('');
      return true;
    } catch (error) {
      if (requestId !== historyRequestRef.current) return false;
      const message = error instanceof Error ? error.message : String(error);
      if (mode === 'replace') {
        const live = mergeActivityEntries(allEntriesRef.current, liveEntriesSinceLoadRef.current).entries;
        liveEntriesSinceLoadRef.current = [];
        allEntriesRef.current = live;
        setAllEntries(live);
        historyLoadingRef.current = false;
        setHistoryLoading(false);
        setLoadError(message);
        historyRetryRef.current = document.visibilityState !== 'visible';
      } else {
        toast(`Live activity resumed, but stored history could not be refreshed: ${message}`, { variant: 'warn', duration: 3600 });
      }
      return false;
    }
  }, [mergeIntoVisibleEntries]);

  useEffect(() => {
    void loadHistory('replace');
    return () => {
      historyRequestRef.current += 1;
      window.clearTimeout(searchTimerRef.current);
      window.clearTimeout(copyTimerRef.current);
    };
  }, [loadHistory]);

  const liveEntries = data.auditTail?.entries;
  useEffect(() => {
    if (!Array.isArray(liveEntries) || liveEntries.length === 0) return;
    if (historyLoadingRef.current) {
      liveEntriesSinceLoadRef.current = mergeActivityEntries(liveEntriesSinceLoadRef.current, liveEntries).entries;
    }
    if (pausedRef.current) {
      pausedEntriesRef.current = mergeActivityEntries(pausedEntriesRef.current, liveEntries).entries;
      return;
    }
    mergeIntoVisibleEntries(liveEntries);
  }, [liveEntries, mergeIntoVisibleEntries]);

  useEffect(() => {
    const onClockTick = event => {
      const tickNow = Number(event?.detail?.now || Date.now());
      if (tickNow >= nextExpiryRef.current) setNow(tickNow);
    };
    const onHashChange = () => {
      const route = readRouteState();
      setFilterState(route.filters);
      setRequestedEventId(route.eventId);
      if (route.eventId) setSelectedEventId(route.eventId);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !historyRetryRef.current) return;
      historyRetryRef.current = false;
      historyLoadingRef.current = true;
      setHistoryLoading(true);
      setLoadError('');
      void loadHistory('replace');
    };
    window.addEventListener('relai:clock-tick', onClockTick);
    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('relai:clock-tick', onClockTick);
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadHistory]);

  useEffect(() => {
    if (!requestedEventId) return;
    if (allEntries.some(entry => activityEventId(entry) === requestedEventId)) setSelectedEventId(requestedEventId);
  }, [allEntries, requestedEventId]);

  useEffect(() => {
    if (!selectionFocusRef.current || !selectedEventId) return;
    selectionFocusRef.current = false;
    if (!window.matchMedia('(max-width: 1140px)').matches) return;
    const heading = inspectorHeadingRef.current;
    if (!(heading instanceof HTMLElement)) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start', inline: 'nearest' });
  }, [selectedEventId, selectedEntry]);

  const syncRoute = useCallback(next => {
    replaceRouteParams({ ...activityRouteParams(next), event: null });
  }, []);

  const applyFilters = useCallback(draft => {
    setFilterState(current => {
      const transition = activityFilterTransition(current, draft);
      const next = transition.filterState;
      if (transition.workspaceChanged) navigate('activity', activityRouteParams(next));
      else syncRoute(next);
      return next;
    });
    if (tableWrapRef.current) tableWrapRef.current.scrollLeft = 0;
  }, [syncRoute]);

  const removeFilter = useCallback(key => {
    setFilterState(current => {
      const next = { ...current };
      if (key === 'timeRange') next.timeRange = '1h';
      else next[key] = '';
      if (key === 'workspace') navigate('activity', activityRouteParams(next));
      else syncRoute(next);
      return next;
    });
    if (tableWrapRef.current) tableWrapRef.current.scrollLeft = 0;
  }, [syncRoute]);

  const clearFilters = useCallback(() => {
    setFilterState(current => {
      const next = { ...EMPTY_FILTERS };
      if (current.workspace) navigate('activity', activityRouteParams(next));
      else syncRoute(next);
      return next;
    });
    if (tableWrapRef.current) tableWrapRef.current.scrollLeft = 0;
  }, [syncRoute]);

  const onSearch = useCallback(value => {
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      setFilterState(current => {
        const next = { ...current, search: value };
        syncRoute(next);
        return next;
      });
    }, 160);
  }, [syncRoute]);

  const openFilters = useCallback(() => {
    openActivityFilters({ filterState, filterOptions, onApply: applyFilters });
  }, [applyFilters, filterOptions, filterState]);

  const togglePause = useCallback(async () => {
    if (!pausedRef.current) {
      pausedRef.current = true;
      pausedEntriesRef.current = [];
      flushSync(() => setPaused(true));
      return;
    }
    pausedRef.current = false;
    flushSync(() => setPaused(false));
    const buffered = pausedEntriesRef.current;
    pausedEntriesRef.current = [];
    mergeIntoVisibleEntries(buffered);
    await loadHistory('merge');
  }, [loadHistory, mergeIntoVisibleEntries]);

  const selectEntry = useCallback(entry => {
    const eventId = activityEventId(entry);
    window.clearTimeout(copyTimerRef.current);
    setCopyState('idle');
    selectionFocusRef.current = true;
    setSelectedEventId(eventId);
  }, []);

  const copySelected = useCallback(async () => {
    if (!selectedEntry) return;
    try {
      await copyText(JSON.stringify(safeEventProjection(selectedEntry), null, 2));
      window.clearTimeout(copyTimerRef.current);
      setCopyState('success');
      copyTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1200);
    } catch {
      toast('Clipboard access failed.', { variant: 'error' });
    }
  }, [selectedEntry]);

  const summary = historyLoading
    ? 'Loading stored activity history…'
    : loadError
      ? `${filteredEntries.length} live event${filteredEntries.length === 1 ? '' : 's'} shown · stored history could not be loaded.`
      : `${filteredEntries.length} of ${allEntries.length} events shown`;
  const count = historyLoading
    ? 'Loading…'
    : loadError
      ? (filteredEntries.length ? `${filteredEntries.length} live event${filteredEntries.length === 1 ? '' : 's'} · history unavailable` : 'History unavailable')
      : `${filteredEntries.length} event${filteredEntries.length === 1 ? '' : 's'}`;

  return h('div', { className: 'section activity-page' },
    h(ActivityFilterBar, {
      filterState,
      filters: activeFilters,
      summary,
      paused,
      onSearch,
      onOpenFilters: openFilters,
      onClearAll: clearFilters,
      onRemoveFilter: removeFilter,
      onTogglePause: togglePause
    }),
    h('div', { id: '__activity-table-wrap', className: 'card activity-event-card' },
      h('div', { className: 'card-head' },
        h('h3', null, 'Activity history'),
        h('span', { className: 'section-action', id: '__activity-count' }, count)
      ),
      h('div', { className: 'activity-master-detail' },
        h('div', { className: 'activity-list-pane' },
          h('div', { className: 'card-body' },
            h('div', { className: 'table-wrap', ref: tableWrapRef },
              h('table', { className: 'data-table activity-table' },
                h('caption', { className: 'sr-only' }, 'Activity history'),
                h('colgroup', null,
                  h('col', { className: 'activity-col-time' }),
                  h('col', { className: 'activity-col-message' })
                ),
                h('thead', null, h('tr', null,
                  h('th', { scope: 'col', className: 'activity-time-column' }, 'Time'),
                  h('th', { scope: 'col', className: 'activity-message-column' }, 'Activity')
                )),
                h('tbody', { id: '__activity-tbody' },
                  renderActivityRows({
                    entries: filteredEntries,
                    historyLoading,
                    loadError,
                    requestedEventId,
                    selectedEventId,
                    sessionIndex,
                    onSelect: selectEntry
                  })
                )
              )
            )
          )
        ),
        h(ActivityInspector, {
          entry: selectedEntry,
          sessionIndex,
          headingRef: inspectorHeadingRef,
          copyState,
          onCopy: copySelected
        })
      )
    )
  );
}

const ActivityFilterBar = memo(function ActivityFilterBar({
  filterState,
  filters,
  summary,
  paused,
  onSearch,
  onOpenFilters,
  onClearAll,
  onRemoveFilter,
  onTogglePause
}) {
  return h('div', { id: '__activity-filter-bar' },
    h('section', { className: 'filter-bar', 'aria-label': 'List filters' },
      h('div', { className: 'filter-bar-controls' },
        h('label', { className: 'filter-search-control' },
          h('span', { className: 'sr-only' }, 'Search activity'),
          h('input', {
            type: 'search',
            className: 'filter-search-input',
            placeholder: 'Search task, activity, action, project, or file',
            defaultValue: filterState.search,
            autoComplete: 'off',
            onInput: event => onSearch(event.currentTarget.value)
          })
        ),
        h('button', {
          type: 'button',
          className: `secondary filter-open-button${filters.length ? ' active' : ''}`,
          'aria-label': filters.length ? `Open filters; ${filters.length} active` : 'Open filters',
          onClick: onOpenFilters
        }, filters.length ? `Filters (${filters.length})` : 'Filters'),
        h('div', { className: 'filter-bar-action' },
          h('button', {
            id: '__activity-freeze',
            type: 'button',
            className: `secondary filter-state-toggle activity-freeze${paused ? ' active' : ''}`,
            'aria-pressed': paused,
            'aria-label': paused ? 'Resume live activity' : 'Freeze live activity',
            title: paused ? 'Resume live activity' : 'Freeze live activity',
            onClick: onTogglePause
          }, h(Icon, { name: paused ? 'play' : 'pause' }))
        )
      ),
      filters.length ? h('div', { className: 'filter-chip-list', 'aria-label': 'Active filters' },
        filters.map(filter => h('button', {
          key: filter.key,
          type: 'button',
          className: 'secondary filter-chip',
          'aria-label': `Remove ${filter.label} filter: ${filter.value}`,
          onClick: () => onRemoveFilter(filter.key)
        }, `${filter.label}: ${filter.value} ×`))
      ) : null,
      h('div', { className: 'filter-bar-footer' },
        h('span', { className: 'filter-summary', role: 'status', 'aria-live': 'polite' }, summary),
        h('button', {
          type: 'button',
          className: 'secondary filter-clear-button',
          hidden: !hasActiveFilters(filterState),
          onClick: onClearAll
        }, 'Clear all')
      )
    )
  );
});

const StatusPill = memo(function StatusPill({ value }) {
  const tone = statusTone(value);
  const cls = pillClass(value);
  return h('span', { className: `status-pill${cls ? ` ${cls}` : ''}` },
    String(value || 'unknown'),
    h('span', { className: 'sr-only' }, ` (${tone})`)
  );
});

const ActivityRow = memo(function ActivityRow({ entry, requested, selected, taskTitle, project, onSelect }) {
  const group = activityStatusGroup(entry);
  const status = entry.status || (group === 'other' ? 'unknown' : group);
  const message = activityMessage(entry);
  const timestamp = eventTimestampValue(entry);
  const absoluteTime = activityAbsoluteTime(entry);
  const action = activityDisplayAction(entry);
  const eventId = activityEventId(entry);
  const className = [
    'activity-data-row',
    requested ? 'activity-requested-row' : '',
    selected ? 'is-selected' : ''
  ].filter(Boolean).join(' ');
  const activate = () => onSelect(entry);
  return h('tr', {
    className,
    'data-activity-event-id': eventId,
    onClick: event => {
      if (event.target.closest('button, a')) return;
      activate();
    }
  },
    h('td', {
      className: 'activity-time-column nowrap small',
      title: absoluteTime,
      'data-clock-relative': timestamp
    }, timeAgo(timestamp) || '—'),
    h('td', { className: 'activity-message-column activity-message-cell' },
      h('button', {
        className: 'activity-row-trigger',
        type: 'button',
        'data-focus-key': `activity-${eventId}`,
        'aria-label': activityActionLabel(entry),
        onClick: activate
      },
        h('span', { className: 'activity-message-copy' }, message),
        h('span', { className: 'activity-row-meta' },
          h(StatusPill, { value: status }),
          h('span', { className: 'activity-row-action' }, action),
          h('span', { className: 'activity-row-task', title: taskTitle }, taskTitle),
          h('span', { className: 'activity-row-project', title: project }, project)
        )
      )
    )
  );
});

function renderActivityRows({ entries, historyLoading, loadError, requestedEventId, selectedEventId, sessionIndex, onSelect }) {
  if (entries.length) {
    return entries.map(entry => {
      const eventId = activityEventId(entry);
      const session = activitySessionView(entry, sessionIndex);
      return h(ActivityRow, {
        key: eventId,
        entry,
        requested: Boolean(requestedEventId && eventId === requestedEventId),
        selected: Boolean(selectedEventId && eventId === selectedEventId),
        taskTitle: session.title || 'Task',
        project: session.workspace || entry.workspace || 'project',
        onSelect
      });
    });
  }
  if (historyLoading) {
    return Array.from({ length: 6 }, (_, index) => h('tr', { className: 'activity-skeleton-row', 'aria-hidden': 'true', key: `skeleton-${index}` },
      h('td', { className: 'activity-time-column' }, h('span', { className: 'activity-skeleton activity-skeleton-time' })),
      h('td', { className: 'activity-message-column activity-message-cell' },
        h('span', { className: `activity-skeleton activity-skeleton-message${index % 3 === 1 ? ' activity-skeleton-message-short' : ''}` }),
        h('span', { className: 'activity-skeleton-meta' },
          h('span', { className: 'activity-skeleton activity-skeleton-status' }),
          h('span', { className: 'activity-skeleton activity-skeleton-context' })
        )
      )
    ));
  }
  const message = loadError
    ? 'Activity history could not be loaded. Live events will appear here when available.'
    : 'No activity matches these filters.';
  return h('tr', null, h('td', { colSpan: 2 }, h('div', { className: 'empty' }, message)));
}

function ActivityInspector({ entry, sessionIndex, headingRef, copyState, onCopy }) {
  if (!entry) {
    return h('aside', { className: 'activity-inspector', 'data-activity-inspector': '' },
      h('div', { className: 'inspector-empty' },
        h('strong', null, 'Select an activity'),
        h('span', null, 'Choose an event to inspect its result, task context, and technical details without leaving the activity stream.')
      )
    );
  }
  const group = activityStatusGroup(entry);
  const displayStatus = entry.status || (group === 'other' ? 'unknown' : group);
  const session = activitySessionView(entry, sessionIndex);
  const fields = [
    ['Tool', toolName(entry)],
    ['Action', entry.action || entry.operation || 'execute'],
    ['Category', entry.category || 'tool'],
    ['Event ID', entry.eventId || entry.id || '—'],
    ['Work session ID', entry.taskId || entry.sessionId || '—'],
    ...(entry.sequence != null ? [['Sequence', entry.sequence]] : [])
  ];
  return h('aside', { className: 'activity-inspector', 'data-activity-inspector': '' },
    h('div', { className: 'activity-inspector-head' },
      h('span', { className: 'overview-kicker' }, 'Activity'),
      h('h2', { tabIndex: -1, ref: headingRef }, entry.title || entry.operation || toolName(entry) || 'Activity detail')
    ),
    h('div', { className: 'detail-stack activity-detail' },
      h('div', { className: 'activity-detail-head' },
        h(StatusPill, { value: displayStatus }),
        h('span', { className: 'muted' }, activityAbsoluteTime(entry))
      ),
      session.id ? h('section', { className: 'activity-detail-section activity-session-context' },
        h('h3', null, 'Task'),
        h('strong', null, session.title),
        h('span', null, [session.workspace, session.shortId].filter(Boolean).join(' · ')),
        h('div', { className: 'activity-session-actions' },
          h('a', {
            className: 'buttonlike secondary',
            href: routeHref('tasks', { workspace: session.workspace || entry.workspace, task: session.id })
          }, 'Task ', h(Icon, { name: 'chevronRight', size: 16 })),
          h('a', {
            className: 'buttonlike secondary',
            href: routeHref('activity', { workspace: session.workspace || entry.workspace, task: session.id, time: 'all' })
          }, 'Show only this task')
        )
      ) : null,
      readableSection('What happened', activityMessage(entry)),
      readableSection('Target', activityTargetLabel(entry)),
      readableSection('Result', activityResultText(entry)),
      readableSection('Error', activityErrorText(entry), 'activity-detail-error'),
      h('details', { className: 'activity-detail-technical' },
        h('summary', null, 'Technical details'),
        h('div', { className: 'activity-detail-fields' },
          fields.map(([label, value]) => h('div', { className: 'detail-field', key: label },
            h('span', { className: 'detail-field-label' }, label),
            h('span', null, String(value))
          ))
        ),
        rawDetail('Raw target', entry.target),
        rawDetail('Raw result', entry.result),
        rawDetail('Safe metadata', entry.metadata),
        rawDetail('Raw error', entry.error),
        h('button', {
          type: 'button',
          className: 'secondary',
          'data-state': copyState === 'success' ? 'success' : undefined,
          onClick: onCopy
        }, copyState === 'success' ? 'Copied' : 'Copy event JSON')
      )
    )
  );
}

function readableSection(title, value, className = '') {
  if (!value) return null;
  return h('section', { className: ['activity-detail-section', className].filter(Boolean).join(' '), key: title },
    h('h3', null, title),
    h('p', null, value)
  );
}

function rawDetail(title, value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' && Object.keys(value).length === 0) return null;
  return h('section', { className: 'activity-detail-raw', key: title },
    h('h4', null, title),
    h('pre', { className: 'detail-pre' }, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  );
}

function openActivityFilters({ filterState, filterOptions, onApply }) {
  openFilterDrawer({
    title: 'Activity filters',
    value: {
      timeRange: filterState.timeRange,
      workspace: filterState.workspace,
      tool: filterState.tool,
      status: filterState.status
    },
    resetValue: { timeRange: '1h', workspace: '', tool: '', status: '' },
    renderFields(fields, draft) {
      fields.append(
        filterRadioField({
          label: 'Time range',
          value: draft.timeRange,
          options: TIME_OPTIONS,
          onChange: value => { draft.timeRange = value; }
        }),
        filterSelectField({
          label: 'Project',
          value: draft.workspace,
          options: activitySelectOptions('All projects', filterOptions.workspaces, draft.workspace),
          onChange: value => { draft.workspace = value; }
        }),
        filterSelectField({
          label: 'Action',
          value: draft.tool,
          options: activitySelectOptions('All actions', filterOptions.tools, draft.tool, activityToolLabel),
          onChange: value => { draft.tool = value; }
        }),
        filterRadioField({
          label: 'Status',
          value: draft.status,
          options: STATUS_OPTIONS,
          onChange: value => { draft.status = value; }
        })
      );
    },
    onApply
  });
}

function readRouteState() {
  const params = getRouteParams();
  const requestedRange = String(params.get('time') || '').toLowerCase();
  return {
    filters: {
      search: params.get('search') || '',
      timeRange: ['15m', '1h', '24h', '7d', 'all'].includes(requestedRange) ? requestedRange : '1h',
      workspace: getWorkspaceFilter(),
      tool: params.get('tool') || '',
      status: routeStatus(params.get('status')),
      task: params.get('task') || ''
    },
    eventId: params.get('event') || ''
  };
}

function routeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'ok') return 'succeeded';
  if (status === 'error') return 'failed';
  return ['succeeded', 'active', 'failed', 'blocked', 'cancelled', 'other'].includes(status) ? status : '';
}

function activityFilters(filterState, sessionIndex) {
  const filters = [];
  const add = (key, label, value, display = value) => {
    if (value) filters.push({ key, label, value: display });
  };
  if (filterState.timeRange !== '1h') add('timeRange', 'Time', filterState.timeRange, filterState.timeRange === 'all' ? 'All time' : filterState.timeRange);
  add('workspace', 'Project', filterState.workspace);
  add('tool', 'Action', filterState.tool, activityToolLabel(filterState.tool));
  add('status', 'Status', filterState.status, statusFilterLabel(filterState.status));
  if (filterState.task) {
    const session = sessionIndex.get(filterState.task);
    add('task', 'Task', filterState.task, session?.title || `Task ${filterState.task.slice(0, 8)}`);
  }
  return filters;
}

function statusFilterLabel(status) {
  return {
    succeeded: 'succeeded',
    active: 'in progress',
    failed: 'failed',
    blocked: 'blocked',
    cancelled: 'cancelled',
    other: 'other'
  }[status] || status;
}

function activityRouteParams(filterState) {
  return {
    workspace: filterState.workspace,
    search: filterState.search || null,
    time: filterState.timeRange === '1h' ? null : filterState.timeRange,
    tool: filterState.tool || null,
    status: filterState.status || null,
    task: filterState.task || null
  };
}

function hasActiveFilters(filterState) {
  return Boolean(
    filterState.search ||
    filterState.workspace ||
    filterState.tool ||
    filterState.status ||
    filterState.task ||
    filterState.timeRange !== '1h'
  );
}

function activitySelectOptions(allLabel, values, selected, labelFor = value => value) {
  const options = selected && !values.includes(selected) ? [selected, ...values] : values;
  return [{ value: '', label: allLabel }, ...options.map(value => ({ value, label: labelFor(value) }))];
}

function buildSessionIndex(tasks = []) {
  const sessions = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const id = String(task?.id || task?.taskId || task?.work_id || '').trim();
    if (!id) continue;
    sessions.set(id, {
      id,
      title: task.title || task.objective || task.currentActivity || 'Task',
      workspace: task.workspace || '',
      status: task.status || ''
    });
  }
  return sessions;
}

function uniqueValues(entries, selector) {
  return [...new Set(entries.map(selector).filter(Boolean).map(String))].sort((left, right) => left.localeCompare(right));
}

function toolName(entry) {
  return entry?.tool?.name || entry?.tool || entry?.type || 'activity';
}

function activityTargetLabel(entry) {
  if (typeof entry.path === 'string' && entry.path.trim()) return entry.path.trim();
  if (typeof entry.target === 'string' && entry.target.trim()) return entry.target.trim();
  return entry.target?.workspaceRelativePath || entry.target?.path || '';
}

function activityResultText(entry) {
  if (typeof entry.result === 'string') return entry.result.trim();
  return String(entry.result?.outcome || entry.result?.summary || '').trim();
}

function activityErrorText(entry) {
  if (typeof entry.error === 'string') return entry.error.trim();
  return String(entry.error?.message || '').trim();
}

function safeEventProjection(entry) {
  if (entry?.safeCopy && typeof entry.safeCopy === 'object') return entry.safeCopy;
  return {
    eventId: entry.eventId || entry.id,
    taskId: entry.taskId,
    sessionId: entry.sessionId,
    sequence: entry.sequence,
    timestamp: entry.timestamp || entry.ts,
    category: entry.category,
    action: entry.action,
    status: entry.status || activityStatusGroup(entry),
    title: entry.title || entry.operation,
    summary: entry.summary || entry.message || activityMessage(entry),
    durationMs: entry.durationMs || entry.ms,
    tool: entry.tool,
    workspace: entry.workspace,
    target: entry.target || (entry.path ? { workspaceRelativePath: entry.path } : undefined),
    result: entry.result,
    error: entry.error,
    metadata: entry.metadata
  };
}
