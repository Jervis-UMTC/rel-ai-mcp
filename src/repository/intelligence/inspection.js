import { diagnosticsWithLsp, inspectWithLsp, providerStatuses } from '../../codeIntelligence/lspManager.js';

const GRAPH_ACTIONS = new Set(['symbol', 'related', 'impact', 'trace', 'architecture', 'audit']);
const LSP_ACTIONS = new Set(['definition', 'hover', 'implementation']);

async function inspectRepositoryCode(nativeInspect, workspace, config = {}, args = {}, options = {}) {
  const action = String(args.action || '').toLowerCase();

  if (action === 'diagnostics') {
    const native = await nativeInspect(workspace, config, { ...args, action: 'diagnostics' }, options);
    if (!args.path) {
      return {
        ...native,
        languageServers: providerStatuses(workspace),
        intelligence: evidence('relai-native', [], false)
      };
    }
    const lsp = await diagnosticsWithLsp(workspace, args, options);
    if (!lsp.available) {
      return {
        ...native,
        languageServers: providerStatuses(workspace),
        intelligence: evidence('relai-native', lsp.provider ? [lsp.provider] : [], true, lsp.status, lsp.error || lsp.reason)
      };
    }
    return {
      ...native,
      diagnostics: lsp.result,
      diagnosticCount: lsp.result.length,
      diagnosticsExecuted: true,
      languageServers: providerStatuses(workspace),
      next: lsp.result.length
        ? 'Address the reported language-server diagnostics, then run repository validation.'
        : 'No language-server diagnostics were reported for this path. Run repository validation for the full project boundary.',
      intelligence: evidence(lsp.provider, ['relai-native'], false, lsp.status)
    };
  }

  if (GRAPH_ACTIONS.has(action)) {
    const native = await nativeInspect(workspace, config, args, options);
    return { ...native, intelligence: evidence('relai-native', [], false) };
  }

  if (action === 'references' && args.symbol) {
    const native = await nativeInspect(workspace, config, args, options);
    return { ...native, intelligence: evidence('relai-native', [], false) };
  }

  if (!LSP_ACTIONS.has(action) && action !== 'references') {
    return nativeInspect(workspace, config, args, options);
  }

  const nativeAction = LSP_ACTIONS.has(action) ? 'symbol' : action;
  const native = args.symbol
    ? await nativeInspect(workspace, config, { ...args, action: nativeAction }, options)
    : null;
  const anchor = resolveAnchor(args, native);
  if (!anchor) return attachFallback(native, null, 'No concrete symbol location was available for language-server resolution.', action);

  const lsp = await inspectWithLsp(workspace, { ...args, action }, anchor, options);
  if (!lsp.available) return attachFallback(native, lsp, lsp.error || lsp.reason, action);

  if (action === 'definition') {
    return {
      ok: true,
      workspace: workspace.alias,
      action,
      symbol: args.symbol || native?.symbol,
      definitions: lsp.result,
      definitionCount: lsp.result.length,
      nativeDefinitions: native?.definitions || [],
      intelligence: evidence(lsp.provider, native ? ['relai-native'] : [], false, lsp.status)
    };
  }
  if (action === 'hover') {
    return {
      ok: true,
      workspace: workspace.alias,
      action,
      symbol: args.symbol || native?.symbol,
      hover: lsp.result,
      definitions: native?.definitions || [],
      intelligence: evidence(lsp.provider, native ? ['relai-native'] : [], false, lsp.status)
    };
  }
  if (action === 'implementation') {
    return {
      ok: true,
      workspace: workspace.alias,
      action,
      symbol: args.symbol || native?.symbol,
      implementations: lsp.result,
      implementationCount: lsp.result.length,
      intelligence: evidence(lsp.provider, native ? ['relai-native'] : [], false, lsp.status)
    };
  }
  return lspReferences(lsp, workspace.alias, args.symbol);
}

function resolveAnchor(args, native) {
  if (args.path && args.line != null && args.column != null) {
    return { path: String(args.path), line: Number(args.line), column: Number(args.column) };
  }
  const definition = native?.definitions?.[0];
  if (!definition) return null;
  return {
    path: definition.path,
    line: Number(definition.line || 1),
    column: Number(definition.column || 0) + 1
  };
}

function lspReferences(lsp, workspaceAlias, symbol) {
  const items = dedupeLocations(lsp.result || []);
  return {
    ok: true,
    workspace: workspaceAlias,
    action: 'references',
    ...(symbol ? { symbol } : {}),
    items,
    matchCount: items.length,
    referenceCount: items.length,
    callCount: 0,
    truncated: false,
    intelligence: evidence(lsp.provider, [], false, lsp.status)
  };
}

function dedupeLocations(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.path}:${item.line}:${item.column || 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function attachFallback(native, lsp, reason, requestedAction = '') {
  if (!native) {
    return {
      ok: false,
      error: reason || 'No code-intelligence provider could answer this request.',
      intelligence: evidence('none', lsp?.provider ? [lsp.provider] : [], true, lsp?.status)
    };
  }
  return {
    ...native,
    ...(requestedAction ? { action: requestedAction, fallbackResultKind: native.action || 'native' } : {}),
    intelligence: evidence('relai-native', lsp?.provider ? [lsp.provider] : [], true, lsp?.status, reason)
  };
}

function evidence(primary, supporting = [], fallbackUsed = false, status = null, fallbackReason = '') {
  return {
    mode: primary === 'relai-native' && supporting.length === 0 ? 'native' : 'hybrid',
    primary,
    supporting,
    authority: primary === 'relai-native' ? 'repository-structural' : primary === 'none' ? 'none' : 'language-server',
    fallbackUsed,
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(status ? { providerStatus: status } : {})
  };
}

export { inspectRepositoryCode };
