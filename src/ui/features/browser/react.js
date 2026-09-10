import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons.js';

const h = React.createElement;

function createBrowserRoute() {
  return function BrowserRoute() {
    const browser = window.relaiDesktop?.browser;
    const [state, setState] = useState(() => emptyState(Boolean(browser)));
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const surfaceRef = useRef(null);
    const frameRef = useRef(0);

    const syncBounds = useCallback(() => {
      if (typeof browser?.setBounds !== 'function') return;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const element = surfaceRef.current;
        if (!element || !state.active) {
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
    }, [browser, state.active]);

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
      if (!browser || !state.active) {
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
    }, [browser, state.active, syncBounds]);

    const run = async (key, action) => {
      if (busy || typeof action !== 'function') return;
      setBusy(key);
      setError('');
      try {
        const next = await action();
        if (next && typeof next === 'object') setState(current => ({ ...current, ...next }));
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setBusy('');
      }
    };

    if (!browser) {
      return h('section', { className: 'section browser-route' },
        h('div', { className: 'browser-empty card' },
          h('h2', null, 'Embedded browser is available in the Rel.AI desktop app.'),
          h('p', null, 'Browser sessions that need this computer appear here when Rel.AI is running as the desktop app.')
        )
      );
    }

    if (!state.active) {
      return h('section', { className: 'section browser-route' },
        h('div', { className: 'browser-empty card' },
          h('h2', null, 'No local browser session is active.'),
          h('p', null, 'When ChatGPT uses Rel.AI for a local browser task, the live page will open here automatically.')
        ),
        error ? h('div', { className: 'connection-notice bad', role: 'alert' }, error) : null
      );
    }

    const userControl = state.control === 'user';
    const sessions = Array.isArray(state.sessions) ? state.sessions : [];
    const tabs = Array.isArray(state.tabs) ? state.tabs : [];
    return h('section', { className: 'section browser-route', 'data-browser-control': userControl ? 'user' : 'ai' },
      h('div', { className: 'browser-toolbar' },
        h('div', { className: 'browser-page-copy' },
          h('div', { className: 'browser-page-title' }, state.loading ? 'Loading…' : (state.title || 'Local browser session')),
          h('div', { className: 'browser-page-url mono', title: state.url || '' }, state.url || 'about:blank')
        ),
        h('span', { className: `status-pill ${userControl ? 'warn' : 'working'}` }, userControl ? 'Your control' : 'AI control'),
        h('div', { className: 'browser-toolbar-actions' },
          h('button', {
            className: userControl ? 'primary' : 'secondary',
            type: 'button',
            disabled: Boolean(busy),
            onClick: () => { void run('control', () => browser.setControl(userControl ? 'ai' : 'user')); }
          }, busy === 'control' ? 'Changing control…' : (userControl ? 'Return control to AI' : 'Take control')),
          h('button', {
            className: 'danger',
            type: 'button',
            disabled: Boolean(busy),
            onClick: () => { void run('stop', () => browser.stop()); }
          }, busy === 'stop' ? 'Stopping…' : 'Stop session')
        )
      ),
      sessions.length > 1
        ? h('div', { className: 'browser-sessions' },
            h('div', { className: 'browser-tabs-label' }, `${sessions.length} sessions`),
            h('div', { className: 'browser-session-list', role: 'list', 'aria-label': 'Open browser sessions' },
              sessions.map((session, index) => {
                const nativeSessionId = String(session?.nativeSessionId || '');
                const activeSession = session?.active === true || nativeSessionId === state.nativeSessionId;
                const label = sessionLabel(session, index);
                return h('button', {
                  className: `browser-session-select${activeSession ? ' active' : ''}`,
                  type: 'button',
                  key: nativeSessionId || `${index}`,
                  role: 'listitem',
                  disabled: Boolean(busy) || !nativeSessionId || (userControl && !activeSession),
                  'aria-current': activeSession ? 'page' : undefined,
                  'aria-label': `Show ${label}`,
                  title: session?.url || label,
                  onClick: () => { void run(`session:${nativeSessionId}`, () => browser.selectSession(nativeSessionId)); }
                }, label);
              })
            )
          )
        : null,
      h('div', { className: 'browser-tabs', 'aria-label': `${tabs.length} open ${tabs.length === 1 ? 'tab' : 'tabs'}` },
        tabs.length
          ? h('div', { className: 'browser-tab-list', role: 'list', 'aria-label': 'Open browser tabs' },
              tabs.map((tab, index) => {
                const label = tabLabel(tab, index);
                const nativePageId = String(tab?.nativePageId || '');
                const activeTab = tab?.active === true || nativePageId === state.nativePageId;
                return h('div', {
                  className: `browser-tab-item${activeTab ? ' active' : ''}`,
                  key: nativePageId || `${index}`,
                  role: 'listitem',
                  'data-browser-tab-active': activeTab ? 'true' : 'false'
                },
                  h('button', {
                    className: 'browser-tab-select',
                    type: 'button',
                    disabled: Boolean(busy) || !nativePageId,
                    'aria-current': activeTab ? 'page' : undefined,
                    'aria-label': `Show ${label}`,
                    title: tab?.url || label,
                    onClick: () => { void run(`tab:${nativePageId}`, () => browser.selectTab(nativePageId)); }
                  },
                    h(Icon, { name: 'browser', className: 'browser-tab-icon', size: 14 }),
                    h('span', { className: 'browser-tab-title' }, tab?.loading ? `${label} — Loading` : label)
                  ),
                  h('button', {
                    className: 'browser-tab-close',
                    type: 'button',
                    disabled: Boolean(busy) || !nativePageId,
                    'aria-label': `Close ${label}`,
                    title: `Close ${label}`,
                    onClick: () => { void run(`close-tab:${nativePageId}`, () => browser.closeTab(nativePageId)); }
                  }, h(Icon, { name: 'close', size: 14 }))
                );
              })
            )
          : h('div', { className: 'browser-tabs-empty', role: 'status' }, 'No tabs are open in this browser session.')
      ),
      error ? h('div', { className: 'connection-notice bad', role: 'alert' }, error) : null,
      h('div', {
        className: 'browser-surface-slot',
        ref: surfaceRef,
        'aria-label': userControl ? 'Live local browser. You have control.' : 'Live local browser. Rel.AI has control.'
      },
        h('div', { className: 'browser-surface-placeholder', 'aria-hidden': 'true' },
          h('span', null, userControl ? 'You control this page' : 'Rel.AI is operating this page')
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
    url: '',
    title: '',
    loading: false,
    visible: false,
    tabs: []
  };
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
