import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { SparkChart } from '../../components/charts.js';
import { Icon } from '../../components/icons.js';
import { pillClass } from '../../components/pill.js';
import { statusTone } from '../../status-tone.js';
import { toast } from '../../components/toast.js';
import { postJson } from '../../api.js';
import { getRouteParams, getWorkspaceFilter, navigate, replaceRouteParams, routeHref } from '../../router.js';
import { analyticsRangeScope } from '../usage/range-model.js';
import { loadAnalyticsModels } from '../usage/data.js';
import { recentWorkspaceAliases, recordRecentWorkspace } from './recents.js';
import {
  actionableFindings,
  findingSeverityLabel,
  humanizeFindingCode,
  orderedWorkspaces,
  repositorySummary,
  workspaceCardView
} from './model.js';
import { DeleteProjectModal, ProjectFormModal, RepairProjectModal } from './react-modals.js';

const h = React.createElement;
const WORKSPACE_STORE_KEYS = Object.freeze(['config', 'health']);

export function createWorkspacesRoute(useDashboardSlices) {
  return function WorkspacesRoute() {
    return h(WorkspacesView, { data: useDashboardSlices(WORKSPACE_STORE_KEYS) });
  };
}

function WorkspacesView({ data = {} }) {
  const allWorkspaces = Array.isArray(data.config?.workspaces) ? data.config.workspaces : [];
  const workspaceFilter = getWorkspaceFilter();
  const routeParams = getRouteParams();
  const focusRequest = routeParams.get('focus') || '';
  const createRequest = routeParams.get('create') === '1';
  const workspaces = useMemo(
    () => orderedWorkspaces(allWorkspaces, workspaceFilter),
    [allWorkspaces, workspaceFilter]
  );
  const workspaceByAlias = useMemo(
    () => new Map(allWorkspaces.map(workspace => [workspace.alias, workspace])),
    [allWorkspaces]
  );
  const health = data.health || {};
  const healthByAlias = useMemo(
    () => new Map((Array.isArray(health.workspaces) ? health.workspaces : []).map(item => [item.alias, item])),
    [health.workspaces]
  );
  const views = useMemo(
    () => workspaces.map(workspace => workspaceCardView(workspace, healthByAlias.get(workspace.alias))),
    [workspaces, healthByAlias]
  );
  const findings = useMemo(() => actionableFindings(health), [health]);
  const availableCount = views.filter(view => view.available).length;
  const [modal, setModal] = useState(null);
  const [recentRevision, setRecentRevision] = useState(0);
  const recent = useMemo(() => recentWorkspaceAliases(allWorkspaces), [allWorkspaces, recentRevision]);
  const analyticsAliases = useMemo(() => views.map(view => view.alias), [views]);
  const analytics = useWorkspaceAnalytics(analyticsAliases);

  useLayoutEffect(() => {
    const alias = routeParams.get('workspace') || '';
    if (!alias || focusRequest !== '1') return;
    const card = document.querySelector(`[data-workspace-card="${cssEscape(alias)}"]`);
    if (!(card instanceof HTMLElement)) return;
    recordRecentWorkspace(alias);
    setRecentRevision(value => value + 1);
    card.tabIndex = -1;
    card.classList.add('workspace-card-focused');
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    replaceRouteParams({ focus: null });
    const timer = window.setTimeout(() => card.classList.remove('workspace-card-focused'), 1800);
    return () => window.clearTimeout(timer);
  }, [workspaceFilter, focusRequest]);

  useEffect(() => {
    if (!createRequest) return;
    replaceRouteParams({ create: null });
    setModal({ kind: 'form', mode: 'add', opener: document.getElementById('commandPaletteBtn') });
  }, [createRequest]);

  const openForm = useCallback((mode, workspace, opener) => setModal({ kind: 'form', mode, workspace, opener }), []);
  const openRepair = useCallback((workspace, opener) => setModal({ kind: 'repair', workspace, opener }), []);
  const openDelete = useCallback((alias, opener) => setModal({ kind: 'delete', alias, opener }), []);
  const closeModal = useCallback(() => setModal(null), []);

  return h('div', { className: 'section', 'data-workspaces-react': '' },
    h('div', { className: 'feature-toolbar workspace-toolbar' },
      h('p', null, 'See each project’s status and common actions.'),
      h('div', { className: 'section-head-actions' },
        workspaceFilter ? h('a', {
          className: 'buttonlike secondary compact-button workspace-focus-chip',
          href: '#workspaces',
          'aria-label': `Clear selected project filter: ${workspaceFilter}`,
          title: 'Show all projects'
        }, h('span', null, workspaceFilter), h('span', { 'aria-hidden': 'true' }, '×')) : null,
        h('span', { className: 'feature-count' }, `${allWorkspaces.length} project${allWorkspaces.length === 1 ? '' : 's'}`),
        h('button', { className: 'primary', type: 'button', onClick: event => openForm('add', null, event.currentTarget) }, 'Add project')
      )
    ),
    !workspaceFilter && recent.length ? h('section', { className: 'workspace-recents', 'aria-label': 'Recent projects' },
      h('span', null, 'Recent projects'),
      h('div', null, recent.map(alias => h('button', {
        className: 'secondary workspace-recent-chip',
        type: 'button',
        key: alias,
        onClick: () => {
          recordRecentWorkspace(alias);
          setRecentRevision(value => value + 1);
          navigate('workspaces', { workspace: alias, focus: '1' });
        }
      }, alias)))
    ) : null,
    !workspaces.length ? h(EmptyWorkspaceState, { onAdd: event => openForm('add', null, event.currentTarget) }) : h(React.Fragment, null,
      h('div', { className: 'overview-grid overview-grid-compact summary-metrics overview-grid-two' },
        h(Metric, {
          label: 'Ready for ChatGPT',
          value: `${availableCount}/${workspaces.length}`,
          meta: availableCount === workspaces.length ? 'All project folders are available' : 'One or more project folders need attention',
          tone: availableCount === workspaces.length ? 'good' : 'warn'
        }),
        h(Metric, {
          label: 'Needs attention',
          value: findings.length,
          meta: findings.length ? 'Problems that may affect a project' : 'No blocking problems',
          tone: findings.length ? 'bad' : 'good'
        })
      ),
      h('div', { className: 'workspace-grid workspace-grid-detailed' },
        views.map(view => h(WorkspaceCard, {
          key: view.alias,
          analytics: analytics.get(view.alias) || null,
          view,
          workspace: workspaceByAlias.get(view.alias),
          onEdit: openForm,
          onRepair: openRepair
        }))
      ),
      findings.length ? h(HealthFindings, { findings, workspaces: allWorkspaces, onRepair: openRepair, onDelete: openDelete }) : null
    ),
    modal?.kind === 'form' ? h(ProjectFormModal, {
      configuredWorkspaces: allWorkspaces,
      mode: modal.mode,
      workspace: modal.workspace,
      opener: modal.opener,
      onClose: closeModal
    }) : null,
    modal?.kind === 'repair' ? h(RepairProjectModal, {
      configuredWorkspaces: allWorkspaces,
      workspace: modal.workspace,
      opener: modal.opener,
      onClose: closeModal
    }) : null,
    modal?.kind === 'delete' ? h(DeleteProjectModal, {
      alias: modal.alias,
      opener: modal.opener,
      onClose: closeModal
    }) : null
  );
}

const WorkspaceCard = memo(function WorkspaceCard({ analytics, view, workspace, onEdit, onRepair }) {
  const [folderBusy, setFolderBusy] = useState(false);
  const repository = repositorySummary(view.operational);
  const notices = [];
  if (view.sessionActive) notices.push(view.taskHint ? `Active session: ${view.taskHint}` : 'Active editing session');
  if (view.cautionCount > 0) notices.push(`${view.cautionCount} protected configuration change${view.cautionCount === 1 ? '' : 's'} recorded`);
  const openFolder = async event => {
    if (folderBusy) return;
    recordRecentWorkspace(view.alias);
    setFolderBusy(true);
    const result = await postJson('/api/open-folder', { workspace: view.alias });
    setFolderBusy(false);
    if (result?.ok === false) toast(result.error || 'Folder opening is only available in the desktop app.', { variant: 'warn' });
    event.currentTarget?.focus?.();
  };
  return h('article', { className: 'workspace-card workspace-card-detailed', 'data-workspace-card': view.alias },
    h('header', { className: 'workspace-card-head' },
      h('div', { className: 'workspace-identity' },
        h('strong', null, view.alias),
        h('div', { className: 'workspace-path', title: view.path }, view.path)
      ),
      h(StatusPill, { label: view.statusLabel })
    ),
    view.healthWarning ? h('div', { className: 'workspace-warning' },
      h('span', null, view.healthWarning),
      h('button', { className: 'secondary', type: 'button', onClick: event => onRepair(workspace, event.currentTarget) }, 'Fix folder')
    ) : null,
    h(WorkspaceReadiness, { available: view.available, repository }),
    notices.length ? h('div', { className: 'workspace-notice' }, notices.map(item => h('span', { key: item }, item))) : null,
    analytics ? h(WorkspaceAnalytics, { scope: analytics }) : null,
    h('footer', { className: 'workspace-actions workspace-primary-actions' },
      document.documentElement.dataset.surface === 'desktop' ? h('button', {
        className: 'secondary', type: 'button', disabled: folderBusy, onClick: event => { void openFolder(event); }
      }, h(CanonicalIcon, { name: 'folder' }), h('span', null, folderBusy ? 'Opening…' : 'Project folder')) : null,
      h('button', { type: 'button', onClick: event => onEdit('edit', workspace, event.currentTarget) }, 'Edit project'),
      h('a', { className: 'buttonlike secondary', href: routeHref('usage', { workspace: view.alias }) }, 'Analytics')
    )
  );
});

function WorkspaceReadiness({ available, repository }) {
  return h('section', { className: `workspace-readiness${available ? ' compact good' : ' bad'}`, 'aria-label': 'Project status' },
    available ? null : h('div', { className: 'workspace-access-summary' },
      h('span', { className: 'workspace-readiness-icon', 'aria-hidden': 'true' }, '!'),
      h('div', { className: 'workspace-readiness-copy' },
        h('span', { className: 'workspace-readiness-kicker' }, 'Project access'),
        h('strong', null, 'Project folder unavailable'),
        h('p', null, 'Fix the project folder before using this project.')
      )
    ),
    h('dl', { className: 'workspace-readiness-facts' },
      h('div', { className: `workspace-readiness-fact ${repository.tone}` },
        h('dt', null, h('i', { 'aria-hidden': 'true' }), repository.kindLabel),
        h('dd', null, h('strong', null, repository.label), h('small', null, repository.description))
      )
    )
  );
}

function HealthFindings({ findings, workspaces, onDelete, onRepair }) {
  return h('section', { className: 'card' },
    h('div', { className: 'card-head' }, h('h3', null, 'Needs attention'), h('a', { className: 'section-action', href: '#diagnostics' }, 'Troubleshoot')),
    h('div', { className: 'card-body list' }, findings.map((finding, index) => {
      const alias = finding.workspace || '';
      const actionable = finding.code === 'workspace_unavailable' && alias;
      const title = finding.message || humanizeFindingCode(finding.code) || 'Project needs attention';
      const context = alias ? `Project: ${alias}` : 'Open Troubleshooting for details.';
      const content = h(React.Fragment, null,
        h('span', { className: `dot ${findingDotClass(finding.severity)}` }),
        h('div', { className: 'finding-main' }, h('div', { className: 'item-title' }, title), h('div', { className: 'item-sub' }, context))
      );
      if (actionable) {
        const workspace = workspaces.find(item => item.alias === alias);
        return h('div', { className: 'list-item finding-row', key: `${finding.code}-${alias}-${index}` },
          content,
          h('div', { className: 'finding-actions' },
            h('button', { className: 'secondary', type: 'button', onClick: event => onRepair(workspace, event.currentTarget) }, 'Fix folder'),
            h('button', { className: 'secondary danger', type: 'button', onClick: event => onDelete(alias, event.currentTarget) }, 'Remove')
          )
        );
      }
      return h('a', { className: 'list-item finding-link', href: '#diagnostics', key: `${finding.code}-${index}` },
        content,
        h('div', { className: 'item-time' }, h(StatusPill, { label: findingSeverityLabel(finding.severity), tone: findingDotClass(finding.severity) }))
      );
    }))
  );
}

function EmptyWorkspaceState({ onAdd }) {
  return h('section', { className: 'workspace-empty-state' },
    h('div', { className: 'workspace-empty-mark', 'aria-hidden': 'true' }, '+'),
    h('strong', null, 'Add your first project'),
    h('p', null, 'Select a local folder and give it a short name. Rel.AI detects Git features and available checks when they are present.'),
    h('button', { className: 'primary', type: 'button', onClick: onAdd }, 'Add project')
  );
}

function Metric({ label, value, meta, tone }) {
  return h('div', { className: `metric ${tone}` }, h('div', { className: 'metric-label' }, label), h('div', { className: 'metric-value' }, value), h('div', { className: 'metric-meta' }, meta));
}

function StatusPill({ label, tone = '' }) {
  const cls = tone || pillClass(label);
  return h('span', { className: `status-pill ${cls}`.trim() }, label, h('span', { className: 'sr-only' }, ` (${statusTone(label)})`));
}

function WorkspaceAnalytics({ scope }) {
  const completed = Number(scope?.completed || 0);
  const toolCalls = Number(scope?.toolCalls || 0);
  const reliabilityCalls = Number(scope?.reliabilityCalls || 0);
  const reliabilityRate = Number(scope?.reliabilityRate || 0);
  const averageDuration = Number(scope?.averageDuration || 0);
  const values = Array.isArray(scope?.points) ? scope.points.map(point => Number(point.toolCalls || 0)) : [];
  return h('section', { className: 'workspace-analytics-mini', 'aria-label': `${scope.workspace || 'Project'} analytics` },
    h('div', { className: 'workspace-analytics-head' }, h('span', null, 'Last 24 hours')),
    h('div', { className: 'workspace-analytics-metrics' },
      h(MiniMetric, { label: 'Actions', value: formatInteger(toolCalls) }),
      h(MiniMetric, { label: 'Reliable', value: reliabilityCalls ? formatPercent(reliabilityRate) : '—' }),
      h(MiniMetric, { label: 'Average time', value: completed ? formatDuration(averageDuration) : '—' })
    ),
    values.length
      ? h(SparkChart, { values, className: 'workspace-analytics-sparkline', mode: 'bar' })
      : h('span', { className: 'workspace-analytics-sparkline-empty', 'aria-hidden': 'true' })
  );
}

function MiniMetric({ label, value }) { return h('div', null, h('span', null, label), h('strong', null, value)); }

function useWorkspaceAnalytics(aliases) {
  const key = aliases.join('\u0000');
  const [scopes, setScopes] = useState(() => new Map());
  useEffect(() => {
    const desktop = globalThis.window?.relaiDesktop;
    if (!aliases.length || !desktop?.getLocalUsage) {
      setScopes(new Map());
      return undefined;
    }
    let active = true;
    void loadAnalyticsModels({ desktop, range: '24h', now: new Date() })
      .then(({ bounds, models }) => {
        if (!active) return;
        setScopes(new Map(aliases.map(alias => [alias, analyticsRangeScope(models, bounds, { workspace: alias })])));
      })
      .catch(() => { if (active) setScopes(new Map()); });
    return () => { active = false; };
  }, [key]);
  return scopes;
}

function CanonicalIcon({ name }) {
  return h(Icon, { name });
}
function findingDotClass(severity) { return severity === 'error' ? 'bad' : severity === 'warning' ? 'warn' : ''; }
function cssEscape(value) { return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`); }
function prefersReducedMotion() { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; }
function formatInteger(value) { return Math.floor(Number(value) || 0).toLocaleString(); }
function formatPercent(value) { const number = Number(value) || 0; return `${number.toFixed(number >= 10 ? 1 : 2)}%`; }
function formatDuration(value) { const ms = Number(value) || 0; if (ms < 1000) return `${Math.floor(ms)} ms`; const seconds = ms / 1000; if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`; return `${(seconds / 60).toFixed(1)} min`; }
