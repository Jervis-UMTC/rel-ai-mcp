import { SERVER_INSTANCE_ID, startMcpStdio } from './core/mcp-runtime.ts';

async function main() {
  return startMcpStdio();
}

export { main, SERVER_INSTANCE_ID };
