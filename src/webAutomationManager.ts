import { registerTerminalTaskCleanup, type AutomationWorkspace } from './computer/automationAttribution.ts';
import {
  isAllowedResourceUrl,
  normalizeUiRoute,
  normalizeViewport,
  resolveUiRoute,
  sanitizeUiUrl,
  timeoutFor
} from './computer/webPolicy.ts';
import {
  pageResult,
  startUiSession,
  stopAllUiSessions,
  stopUiSession,
  stopUiSessionsForTask,
  withUiSession,
  type UiArgs,
  type UiContext
} from './computer/webSessionRegistry.ts';

registerTerminalTaskCleanup(stopUiSessionsForTask);

async function runUiAction(
  workspace: AutomationWorkspace,
  _config: unknown,
  args: UiArgs = {},
  context: UiContext = {}
): Promise<Record<string, unknown>> {
  const action = String(args.action || '').trim();
  switch (action) {
    case 'start':
      return startUiSession(workspace, args, context);
    case 'navigate':
      return Promise.resolve(withUiSession(workspace, args, context, async record => pageResult(
        record,
        'navigate',
        await record.browser.navigate(resolveUiRoute(record.origin, args.route), timeoutFor(args.timeoutMs))
      )));
    case 'snapshot':
      return Promise.resolve(withUiSession(workspace, args, context, async record => pageResult(
        record,
        'snapshot',
        await record.browser.snapshot(timeoutFor(args.timeoutMs))
      )));
    case 'interact':
      return Promise.resolve(withUiSession(workspace, args, context, async record => pageResult(
        record,
        'interact',
        await record.browser.interact(args, timeoutFor(args.timeoutMs))
      )));
    case 'screenshot':
      return Promise.resolve(withUiSession(workspace, args, context, async record => pageResult(
        record,
        'screenshot',
        await record.browser.screenshot(args.fullPage === true)
      )));
    case 'console':
      return Promise.resolve(withUiSession(workspace, args, context, record => pageResult(
        record,
        'console',
        record.browser.readEntries('console', args.maxEntries, args.clear === true)
      )));
    case 'network':
      return Promise.resolve(withUiSession(workspace, args, context, record => pageResult(
        record,
        'network',
        record.browser.readEntries('network', args.maxEntries, args.clear === true)
      )));
    case 'viewport':
      return Promise.resolve(withUiSession(workspace, args, context, async record => pageResult(
        record,
        'viewport',
        await record.browser.setViewport(normalizeViewport(args.width, args.height, true))
      )));
    case 'reload':
      return Promise.resolve(withUiSession(workspace, args, context, async record => pageResult(
        record,
        'reload',
        await record.browser.reload(timeoutFor(args.timeoutMs))
      )));
    case 'stop':
      return stopUiSession(workspace, args, context);
    default:
      throw new Error(`Unsupported relai_ui action '${action || '(missing)'}.`);
  }
}

export {
  isAllowedResourceUrl,
  normalizeUiRoute,
  resolveUiRoute,
  runUiAction,
  sanitizeUiUrl,
  stopAllUiSessions
};
