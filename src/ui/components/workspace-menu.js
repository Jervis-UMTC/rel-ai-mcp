export function orderWorkspacesAlphabetically(workspaces = []) {
  return [...(Array.isArray(workspaces) ? workspaces : [])].sort((left, right) =>
    String(left?.alias || '').localeCompare(String(right?.alias || ''), 'en-US', { numeric: true, sensitivity: 'base' })
  );
}
