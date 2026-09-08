import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startHttpServer } from '../src/httpServer.ts';
import { mcpConnectionManager } from '../src/mcp/connectionManager.js';

const httpServerSource = fs.readFileSync(new URL('../src/httpServer.ts', import.meta.url), 'utf8');
assert.match(httpServerSource, /if \(!isolated\) \{[\s\S]*?pruneManagedProcesses\(runtimeConfig\)/, 'isolated HTTP servers must not prune shared managed-process state');
assert.match(httpServerSource, /createRelaiCoreRuntime\(\{[\s\S]*?isolated,[\s\S]*?stopManagedProcessesOnShutdown:/, 'HTTP shutdown must delegate managed-process ownership to the shared core runtime with the isolated boundary intact');

const authTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-auth-precondition-'));
const authConfig = path.join(authTemp, 'config.json');
const authStateDir = path.join(authTemp, 'state');
const previousConfig = process.env.REL_AI_MCP_CONFIG;
const previousToken = process.env.REL_AI_MCP_TOKEN;
const previousAllowNoAuth = process.env.REL_AI_MCP_ALLOW_NO_AUTH;
fs.writeFileSync(authConfig, JSON.stringify({ version: 3, stateDir: authStateDir, workspaces: {} }, null, 2));
process.env.REL_AI_MCP_CONFIG = authConfig;
delete process.env.REL_AI_MCP_TOKEN;
delete process.env.REL_AI_MCP_ALLOW_NO_AUTH;
try {
  assert.throws(
    () => startHttpServer({ host: '127.0.0.1', port: 0, writeProfile: false }),
    /REL_AI_MCP_TOKEN is required/
  );
  assert.equal(fs.existsSync(authStateDir), false, 'missing HTTP auth must fail before durable state initialization');
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  if (previousToken == null) delete process.env.REL_AI_MCP_TOKEN;
  else process.env.REL_AI_MCP_TOKEN = previousToken;
  if (previousAllowNoAuth == null) delete process.env.REL_AI_MCP_ALLOW_NO_AUTH;
  else process.env.REL_AI_MCP_ALLOW_NO_AUTH = previousAllowNoAuth;
  fs.rmSync(authTemp, { recursive: true, force: true });
}

const server = startHttpServer({
  host: '127.0.0.1',
  port: 0,
  allowNoAuth: true,
  writeProfile: false,
  getRuntimeAccess: () => ({
    blocked: true,
    errorCode: 'update_required',
    message: 'Rel.AI MCP must be updated before MCP work can continue.'
  })
});

try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200, 'dashboard/service health must remain available during an update block');
  const mcp = await fetch(`http://127.0.0.1:${port}/mcp`);
  assert.equal(mcp.status, 426, 'MCP transport must be blocked when the runtime support policy requires an update');
  const payload = await mcp.json();
  assert.equal(payload.errorCode, 'update_required');
} finally {
  const originalShutdown = mcpConnectionManager.shutdown;
  mcpConnectionManager.shutdown = async () => { throw new Error('injected connection-manager shutdown failure'); };
  await new Promise(resolve => server.close(resolve));
  const cleanup = await server.waitForShutdown?.();
  mcpConnectionManager.shutdown = originalShutdown;
  assert.equal(cleanup.clean, false, 'HTTP shutdown must report transport cleanup failures as unclean');
  assert.ok(
    cleanup.errors.some(item => item.step === 'mcpConnectionManager' && /injected connection-manager shutdown failure/.test(item.error)),
    'HTTP shutdown must retain the transport cleanup failure details'
  );
}

console.log('Remote update support policy HTTP gate passed.');
