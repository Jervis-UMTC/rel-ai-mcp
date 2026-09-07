#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { startHttpServer } from '../src/httpServer.ts';

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError('Port must be an integer from 0 to 65535.');
  }
  return port;
}

const program = new Command()
  .name('rel-ai-mcp-http')
  .description('Start the Rel.AI MCP local HTTP server.')
  .option('--host <host>', 'Bind host. Default: 127.0.0.1')
  .option('--port <port>', 'Bind port. Default: 3333', parsePort)
  .option('--token <token>', 'Bearer token. Prefer REL_AI_MCP_TOKEN.')
  .option('--allow-no-auth', 'Disable auth for local testing only.')
  .option('--no-profile-write', 'Do not update the saved connector profile (connection.json).')
  .showHelpAfterError();

program.addHelpText('after', '\nExample:\n  REL_AI_MCP_TOKEN=... rel-ai-mcp-http --host 127.0.0.1 --port 3333');
program.parse(process.argv);

const parsed = program.opts();
try {
  startHttpServer({
    ...(parsed.host ? { host: parsed.host } : {}),
    ...(parsed.port != null ? { port: parsed.port } : {}),
    ...(parsed.token ? { token: parsed.token } : {}),
    allowNoAuth: parsed.allowNoAuth === true,
    writeProfile: parsed.profileWrite !== false
  });
} catch (error) {
  console.error(`[rel-ai-mcp-http] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
}
