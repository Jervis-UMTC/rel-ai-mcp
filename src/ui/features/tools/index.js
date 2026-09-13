export const TOOL_CAPABILITIES = Object.freeze([
  { id: 'all', label: 'All capabilities' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'edit', label: 'Edit' },
  { id: 'execute', label: 'Execute' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'review', label: 'Review' },
  { id: 'validate', label: 'Validate' },
  { id: 'git', label: 'Git' },
  { id: 'recover', label: 'Recover' }
]);

const CAPABILITY_ORDER = new Map(TOOL_CAPABILITIES.slice(1).map((item, index) => [item.id, index]));
export const TOOL_CAPABILITY_IDS = new Set(TOOL_CAPABILITIES.slice(1).map(item => item.id));

export function toolsFromPayload(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.tools)) return result.tools;
  return null;
}

export function orderToolsForCatalog(tools = []) {
  return [...(Array.isArray(tools) ? tools : [])].sort((left, right) => {
    const capabilityDifference = capabilityRank(left) - capabilityRank(right);
    if (capabilityDifference) return capabilityDifference;
    return toolSortLabel(left).localeCompare(toolSortLabel(right), 'en-US', { numeric: true, sensitivity: 'base' });
  });
}

export function toolCapabilities(tool) {
  const explicit = Array.isArray(tool?.capabilities)
    ? tool.capabilities.filter(capability => TOOL_CAPABILITY_IDS.has(capability))
    : [];
  return explicit.length ? [...new Set(explicit)] : ['inspect'];
}

export function capabilityLabel(capability) {
  return TOOL_CAPABILITIES.find(item => item.id === capability)?.label || 'Inspect';
}

export function capabilityCount(tools = [], capability = 'all') {
  if (capability === 'all') return tools.length;
  return tools.filter(tool => toolCapabilities(tool).includes(capability)).length;
}

export function toolMatchesFilters(tool, { search = '', capability = 'all' } = {}) {
  const capabilities = toolCapabilities(tool);
  if (capability !== 'all' && !capabilities.includes(capability)) return false;
  const query = String(search || '').trim().toLowerCase();
  if (!query) return true;
  const searchable = [tool?.name, tool?.title, tool?.displayName, tool?.description, ...(Array.isArray(tool?.parameters) ? tool.parameters : [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return searchable.includes(query);
}

function capabilityRank(tool) {
  return CAPABILITY_ORDER.get(toolCapabilities(tool)[0] || 'inspect') ?? CAPABILITY_ORDER.size;
}

function toolSortLabel(tool) {
  return String(tool?.title || tool?.displayName || tool?.name || '');
}
