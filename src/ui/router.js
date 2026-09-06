// Hash-based dashboard navigation with persistent workspace scope.
import { clearUnsavedChanges, hasUnsavedChanges, initInteractionSafety } from './interaction-safety.js';
import { confirmAction } from './components/confirm-dialog.js';
import { normalizeRouteKey } from './route-policy.js';

let _currentRouteKey = null;
let _bound = false;

export function initRouter() {
  initInteractionSafety();
  if (!_bound) {
    window.addEventListener('hashchange', _route);
    _bound = true;
  }
  void _route();
}

export function currentRoutePath() {
  return routeParts().path;
}

export function getRouteParams() {
  return routeParts().params;
}

export function getWorkspaceFilter() {
  return getRouteParams().get('workspace') || '';
}

export function routeHref(sectionId, params = {}) {
  const query = new URLSearchParams();
  const workspace = Object.hasOwn(params, 'workspace') ? params.workspace : getWorkspaceFilter();
  if (workspace) query.set('workspace', workspace);
  for (const [key, value] of Object.entries(params)) {
    if (key === 'workspace' || value == null || value === '') continue;
    query.set(key, String(value));
  }
  return `#${normalizeRouteKey(`${sectionId}${querySuffix(query)}`)}`;
}

export function setWorkspaceFilter(workspace) {
  const parts = routeParts();
  if (workspace) parts.params.set('workspace', workspace);
  else parts.params.delete('workspace');
  parts.params.delete('focus');
  location.hash = `#${normalizeRouteKey(`${parts.path}${querySuffix(parts.params)}`)}`;
}

export function replaceRouteParams(patch = {}) {
  const parts = routeParts();
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') parts.params.delete(key);
    else parts.params.set(key, String(value));
  }
  const routeKey = normalizeRouteKey(`${parts.path}${querySuffix(parts.params)}`);
  replaceRouteState(routeKey);
  return routeParts().params;
}

export function navigate(sectionId, params = {}) {
  location.hash = routeHref(sectionId, params);
}

function querySuffix(params) {
  const value = params.toString();
  return value ? `?${value}` : '';
}

function routeParts() {
  const raw = currentRouteKey();
  const separator = raw.indexOf('?');
  const path = separator >= 0 ? raw.slice(0, separator) : raw;
  const query = separator >= 0 ? raw.slice(separator + 1) : '';
  return { path: path || 'home', params: new URLSearchParams(query) };
}

function rawRouteKey() {
  return (location.hash || '#home').slice(1) || 'home';
}

function currentRouteKey() {
  return normalizeRouteKey(rawRouteKey());
}

function replaceRouteState(routeKey) {
  history.replaceState(null, '', `${location.pathname}${location.search}#${routeKey}`);
  try { localStorage.setItem('relai_dashboard_route', routeKey); } catch {}
}

async function _route() {
  const rawKey = rawRouteKey();
  const routeKey = normalizeRouteKey(rawKey);
  if (routeKey !== rawKey) replaceRouteState(routeKey);
  if (routeKey === _currentRouteKey) return;

  if (_currentRouteKey && hasUnsavedChanges()) {
    const previousRouteKey = _currentRouteKey;
    replaceRouteState(previousRouteKey);
    const confirmed = await confirmAction({
      title: 'Discard changes?',
      message: 'Discard unsaved changes and leave this page?',
      detail: 'Your changes will not be saved.',
      confirmLabel: 'Discard changes',
      danger: true
    });
    if (!confirmed) return;
    clearUnsavedChanges();
    replaceRouteState(routeKey);
    return _route();
  }

  const id = routeKey.split(/[/?]/)[0] || 'home';
  _currentRouteKey = routeKey;
  try { localStorage.setItem('relai_dashboard_route', routeKey); } catch {}
  window.dispatchEvent(new CustomEvent('relai:route-change', {
    detail: { section: id, path: currentRoutePath(), params: getRouteParams() }
  }));
}
