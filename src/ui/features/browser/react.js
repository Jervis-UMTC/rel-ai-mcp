import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons.js';

const h = React.createElement;

function createBrowserRoute() {
  return function BrowserRoute() {
    const browser = window.relaiDesktop?.browser;
    const [state, setState] = useState(() => emptyState(Boolean(browser)));
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [copyStatus, setCopyStatus] = useState('');
    const surfaceRef = useRef(null);
    const frameRef = useRef(0);

    const syncBounds = useCallback(() => {
      if (typeof browser?.setBounds !== 'function') return;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const element = surfaceRef.current;
        if (!element || !state.active || state.headless === true) {
          void Promise.resolve(browser.setBounds({ visible: false })).catch(() => {});
          return;
        }
        const rect = element.getBoundingClientRect();
        const visible = rect.width >= 1 && rect.height >= 1
          && rect.bottom > 0 && rect.right > 0
          && rect.top < window.innerHeight && rect.left < window.innerWidth;
        if (!visible) {
          void Promise.resolve(browser.setBounds({ visible: false })).catch(() => {});
          return;
        }
        void Promise.resolve(browser.setBounds({
          visible: true,
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height))
        })).catch(nextError => setError(errorMessage(nextError)));
      });
    }, [browser, state.active, state.headless]);

    useEffect(() => {
      if (!browser) return undefined;
      let active = true;
      const apply = next => {
        if (!active || !next || typeof next !== 'object') return;
        setState(current => ({ ...current, ...next, available: next.available !== false }));
      };
      const unsubscribe = typeof browser.onState === 'function' ? browser.onState(apply) : null;
      Promise.resolve(browser.getState?.()).then(apply).catch(nextError => {
        if (active) setError(errorMessage(nextError));
      });
      return () => {
        active = false;
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    }, [browser]);

    useEffect(() => {
      if (!browser || !state.active || state.headless === true) {
        if (browser) void Promise.resolve(browser.setBounds({ visible: false })).catch(() => {});
        return undefined;
      }
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(syncBounds) : null;
      if (surfaceRef.current) observer?.observe(surfaceRef.current);
      const schedule = () => syncBounds();
      window.addEventListener('resize', schedule);
      window.addEventListener('scroll', schedule, true);
      syncBounds();
      return () => {
        observer?.disconnect();
        window.removeEventListener('resize', schedule);
        window.removeEventListener('scroll', schedule, true);
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
        void Promise.resolve(browser.setBounds({ visible: false })).catch(() => {});
      };
    }, [browser, state.active, state.headless, syncBounds]);

    const tabListRef = useRef(null);
    const activeTabRef = useRef(null);
    useEffect(() => {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }, [state.nativePageId, state.tabs?.length]);

    useEffect(() => {
      setCopyStatus('');
    }, [state.url]);

    useEffect(() => {
      if (!copyStatus) return undefined;
      const timer = window.setTimeout(() => setCopyStatus(''), 1200);
      return () => window.clearTimeout(timer);
    }, [copyStatus]);

    const run = async (key, action) => {
      if (busy === key || typeof action !== 'function') return;
      setBusy(key);
      setError('');
      try {
        const next = await action();
        if (next && typeof next === 'object') setState(current => ({ ...current, ...next }));
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setBusy(current => (current === key ? '' : current));
      }
    };

    const focusTab = useCallback(index => {
      const list = tabListRef.current;
      const buttons = list ? [...list.querySelectorAll('.browser-tab-select')] : [];
      const target = buttons[index];
      if (target) target.focus();
    }, []);

    const onTabListKeyDown = useCallback(event => {
      const list = tabListRef.current;
      if (!list) return;
      const buttons = [...list.querySelectorAll('.browser-tab-select')];
      const currentIndex = buttons.indexOf(document.activeElement);
      if (currentIndex < 0) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        focusTab((currentIndex + 1) % buttons.length);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        focusTab((currentIndex - 1 + buttons.length) % buttons.length);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusTab(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusTab(buttons.length - 1);
      }
    }, [focusTab]);

    if (!browser) {
      return h('section', { className: 'section browser-route' },
        h('div', { className: 'browser-empty card' },
          h(Icon, { name: 'browser', className: 'browser-empty-icon', size: 28 }),
          h('h2', null, 'Embedded browser lives in the Rel.AI desktop app.'),
          h('p', null, 'Browser sessions that need this computer appear here when Rel.AI is running as the desktop app.')
        )
      );
    }

    if (!state.active) {
      return h('section', { className: 'section browser-route' },
        h('div', { className: 'browser-empty card' },
          h(Icon, { name: 'browser', className: 'browser-empty-icon', size: 28 }),
          h('h2', null, 'No local browser session is active.'),
          h('p', null, 'When ChatGPT uses Rel.AI for a local browser task, the live page will open here automatically.'),
          h('div', { className: 'browser-empty-hint' },
            h('span', { className: 'status-pill' }, 'Waiting for AI'),
            h('span', null, 'Tabs, sessions, and page preview appear in one place.')
          )
        ),
        error ? h('div', { className: 'connection-notice bad', role: 'alert' }, error) : null
      );
    }

    const userControl = state.control === 'user';
    const headless = state.headless === true;
    const sessions = Array.isArray(state.sessions) ? state.sessions : [];
    const tabs = Array.isArray(state.tabs) ? state.tabs : [];
    const activeIndex = Math.max(0, tabs.findIndex(tab => tab?.active === true || String(tab?.nativePageId || '') === state.nativePageId));
    const pageHost = hostOf(state.url);
    const viewportLabel = formatViewport(state.viewport);
    return h('section', { className: 'section browser-route', 'data-browser-control': userControl ? 'user' : 'ai' },
      h('div', { className: 'browser-chrome card' },
        sessions.length > 1
          ? h('div', { className: 'browser-sessions' },
              h('div', { className: 'browser-tabs-label' },
                h('span', { className: 'browser-count-badge', 'aria-hidden': 'true' }, String(sessions.length)),
                h('span', null, sessions.length === 1 ? 'session' : 'sessions')
              ),
              h('div', { className: 'browser-session-list', role: 'list', 'aria-label': 'Open browser sessions' },
                sessions.map((session, index) => {
                  const nativeSessionId = String(session?.nativeSessionId || '');
                  const activeSession = session?.active === true || nativeSessionId === state.nativeSessionId;
                  const label = sessionLabel(session, index);
                  const pending = busy === `session:${nativeSessionId}`;
                  return h('button', {
                    className: `browser-session-select${activeSession ? ' active' : ''}${pending ? ' pending' : ''}${session?.headless ? ' headless' : ''}`,
                    type: 'button',
                    key: nativeSessionId || `${index}`,
                    disabled: pending || !nativeSessionId || (userControl && !activeSession),
                    'aria-current': activeSession ? 'page' : undefined,
                    'aria-label': `Show ${label}`,
                    title: session?.url ? `${label}\n${session.url}` : label,
                    onClick: () => { void run(`session:${nativeSessionId}`, () => browser.selectSession(nativeSessionId)); }
                  },
                    h('span', { className: 'browser-session-dot', 'aria-hidden': 'true' }),
                    h('span', { className: 'browser-session-name' }, shortLabel(label)),
                    session?.headless ? h('span', { className: 'badge browser-headless-badge' }, 'Headless') : null,
                    pending ? h('span', { className: 'browser-spinner', 'aria-hidden': 'true' }) : null
                  );
                })
              )
            )
          : null,
        h('div', { className: 'browser-tabbar' },
          h('div', { className: 'browser-tabs', 'aria-label': `${tabs.length} open ${tabs.length === 1 ? 'tab' : 'tabs'}` },
            tabs.length
              ? h('div', {
                  className: 'browser-tab-list',
                  role: 'tablist',
                  ref: tabListRef,
                  'aria-label': 'Open browser tabs',
                  onKeyDown: onTabListKeyDown
                },
                  tabs.map((tab, index) => {
                    const label = tabLabel(tab, index);
                    const nativePageId = String(tab?.nativePageId || '');
                    const activeTab = tab?.active === true || nativePageId === state.nativePageId;
                    const pendingSelect = busy === `tab:${nativePageId}`;
                    const pendingClose = busy === `close-tab:${nativePageId}`;
                    const tabBusy = pendingSelect || pendingClose;
                    const fullTitle = tab?.url && tab.url !== label ? `${label}\n${tab.url}` : (tab?.url || label);
                    return h('div', {
                      className: `browser-tab-item${activeTab ? ' active' : ''}${tab?.loading || pendingSelect ? ' loading' : ''}${tabBusy ? ' pending' : ''}`,
                      key: nativePageId || `${index}`,
                      role: 'presentation',
                      ref: activeTab ? activeTabRef : undefined,
                      'data-browser-tab-active': activeTab ? 'true' : 'false'
                    },
                      h('button', {
                        className: 'browser-tab-select',
                        type: 'button',
                        role: 'tab',
                        disabled: !nativePageId || pendingClose,
                        tabIndex: activeTab ? 0 : (activeIndex === 0 && index === 0 ? 0 : -1),
                        'aria-selected': activeTab ? 'true' : 'false',
                        'aria-label': `${label}${activeTab ? ', active tab' : `, tab ${index + 1} of ${tabs.length}`}${tab?.loading ? ', loading' : ''}`,
                        title: fullTitle,
                        onClick: () => { void run(`tab:${nativePageId}`, () => browser.selectTab(nativePageId)); },
                        onAuxClick: event => {
                          if (event?.button === 1 && nativePageId) {
                            event.preventDefault();
                            void run(`close-tab:${nativePageId}`, () => browser.closeTab(nativePageId));
                          }
                        }
                      },
                        tab?.loading || pendingSelect
                          ? h('span', { className: 'browser-spinner', 'aria-hidden': 'true' })
                          : h('span', { className: 'browser-tab-favicon', 'aria-hidden': 'true' }, faviconLetter(label)),
                        h('span', { className: 'browser-tab-title' }, label),
                        tab?.loading ? h('span', { className: 'browser-tab-loading-dots', 'aria-hidden': 'true' }, '•••') : null
                      ),
                      h('button', {
                        className: 'browser-tab-close',
                        type: 'button',
                        disabled: !nativePageId || tabBusy,
                        tabIndex: activeTab ? 0 : -1,
                        'aria-label': `Close ${label}`,
                        title: `Close ${label} (middle-click also closes)`,
                        onClick: event => {
                          event.stopPropagation();
                          void run(`close-tab:${nativePageId}`, () => browser.closeTab(nativePageId));
                        }
                      }, h(Icon, { name: 'close', size: 13 }))
                    );
                  })
                )
              : h('div', { className: 'browser-tabs-empty', role: 'status' },
                  h(Icon, { name: 'add', size: 14 }),
                  h('span', null, 'No tabs open — new pages from the agent appear here.')
                )
          ),
          tabs.length > 1
            ? h('div', { className: 'browser-tab-count', title: `${tabs.length} open tabs`, 'aria-hidden': 'true' }, `${activeIndex + 1} / ${tabs.length}`)
            : null
        ),
        h('div', { className: 'browser-toolbar' },
          h('div', { className: 'browser-omnibox' },
            h('span', { className: `browser-secure${pageHost ? ' ok' : ''}`, title: pageHost ? `Site: ${pageHost}` : 'No page loaded', 'aria-hidden': 'true' },
              h(Icon, { name: pageHost ? 'success' : 'browser', size: 14 })
            ),
            h('div', { className: 'browser-page-copy' },
              h('div', { className: 'browser-page-title' }, state.loading ? 'Loading…' : (state.title || 'Local browser session')),
              h('div', { className: 'browser-page-url mono', title: state.url || '' }, state.url ? displayUrl(state.url) : 'about:blank')
            ),
            state.loading ? h('span', { className: 'browser-spinner browser-omnibox-spinner', 'aria-hidden': 'true' }) : null,
            state.url
              ? h('button', {
                  className: `browser-copy-url${copyStatus ? ' copied' : ''}`,
                  type: 'button',
                  'aria-label': copyStatus ? 'Page URL copied' : 'Copy page URL',
                  title: copyStatus ? 'Page URL copied' : 'Copy page URL',
                  onClick: () => {
                    void copyText(state.url).then(copied => {
                      if (copied) setCopyStatus('Page URL copied.');
                      else setError('Could not copy page URL.');
                    });
                  }
                }, h(Icon, { name: 'connection', size: 14 }))
              : null,
            h('span', { className: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, copyStatus)
          ),
          state.loading ? h('div', { className: 'browser-loading-bar', 'aria-hidden': 'true' }, h('i', null)) : null,
          h('span', { className: `status-pill ${userControl ? 'warn' : 'working'}` }, headless ? 'Headless · AI control' : (userControl ? 'Your control' : 'AI control · Read-only')),
          viewportLabel ? h('span', { className: 'browser-viewport-pill mono', title: 'AI browser viewport' }, viewportLabel) : null,
          h('div', { className: 'browser-toolbar-actions' },
            headless ? null : h('button', {
                className: userControl ? 'primary' : 'secondary',
                type: 'button',
                disabled: busy === 'control' || busy === 'stop',
                onClick: () => { void run('control', () => browser.setControl(userControl ? 'ai' : 'user')); }
              }, busy === 'control' ? 'Changing…' : (userControl ? 'Return to AI' : 'Take control')),
            h('button', {
              className: 'danger',
              type: 'button',
              disabled: busy === 'control' || busy === 'stop',
              'aria-label': 'Stop browser session',
              title: 'Stop browser session',
              onClick: () => { void run('stop', () => browser.stop()); }
            }, busy === 'stop' ? 'Stopping…' : 'Stop')
          )
        )
      ),
      error ? h('div', { className: 'connection-notice bad', role: 'alert' }, error) : null,
      h('div', {
        className: 'browser-surface-slot',
        ref: surfaceRef,
        role: 'region',
        'data-headless': headless ? 'true' : 'false',
        'aria-label': headless
          ? `Headless local browser. Rel.AI controls this page${viewportLabel ? ` at ${viewportLabel}` : ''}.`
          : (userControl ? 'Live local browser. You have control.' : 'Live local browser. Rel.AI has control. User input is read-only.')
      },
        h('div', { className: 'browser-surface-placeholder', 'aria-hidden': 'true' },
          h(Icon, { name: userControl ? 'play' : 'browser', size: 20, className: 'browser-surface-icon' }),
          h('span', null, headless
            ? 'Running headless — no live browser surface is attached.'
            : (userControl ? 'You control this page — interact directly.' : 'Watch live — take control to interact.')),
          h('span', { className: 'browser-surface-sub' }, headless
            ? `Rel.AI is operating this page${viewportLabel ? ` at ${viewportLabel}` : ''}.`
            : (pageHost ? pageHost : 'Live view renders here'))
        )
      )
    );
  };
}

function emptyState(available) {
  return {
    ok: true,
    available,
    active: false,
    activeSessionCount: 0,
    control: 'ai',
    headless: false,
    viewport: null,
    url: '',
    title: '',
    loading: false,
    visible: false,
    tabs: []
  };
}

function formatViewport(viewport) {
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return '';
  return `${Math.round(width)} × ${Math.round(height)}`;
}

function hostOf(url) {
  const value = String(url || '').trim();
  if (!value || value === 'about:blank') return '';
  try { return new URL(value).hostname || ''; } catch { return ''; }
}

function displayUrl(url) {
  const value = String(url || '');
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

function shortLabel(label) {
  const value = String(label || '');
  return value.replace(/\s+·\s+Headless$/, '');
}

function faviconLetter(label) {
  const value = String(label || '').trim();
  const char = value ? [...value][0] : '•';
  return (char || '•').toUpperCase();
}

async function copyText(value) {
  const text = String(value || '');
  if (!text) return false;
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  try {
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

function sessionLabel(session, index) {
  const title = String(session?.title || '').trim();
  if (title) return `${title}${session?.headless ? ' · Headless' : ''}`;
  const url = String(session?.url || '').trim();
  if (url) {
    try { return `${new URL(url).hostname || url}${session?.headless ? ' · Headless' : ''}`; } catch { return url; }
  }
  return `Session ${index + 1}${session?.headless ? ' · Headless' : ''}`;
}

function tabLabel(tab, index) {
  const title = String(tab?.title || '').trim();
  if (title) return title;
  const url = String(tab?.url || '').trim();
  if (url && url !== 'about:blank') {
    try { return new URL(url).hostname || url; } catch { return url; }
  }
  return `Tab ${index + 1}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Embedded browser operation failed.');
}

export { createBrowserRoute };
