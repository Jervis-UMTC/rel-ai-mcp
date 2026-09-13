import type { McpAccess } from './types.ts';

function getMcpAccess(pathname: string): McpAccess {
  return pathname === '/mcp' ? { kind: 'streamable-http' } : { kind: 'none' };
}

export { getMcpAccess };
