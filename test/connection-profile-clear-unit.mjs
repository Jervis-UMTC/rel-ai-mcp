import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearConnectionState,
  readConnectionProfile,
  readLaunchEnv,
  writeConnectionProfile,
  writeLaunchEnv
} from '../src/connectionProfile.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-logout-connection-'));
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_STATE_DIR = root;

try {
  fs.writeFileSync(path.join(root, 'config.json'), '{"keep":true}\n');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sessions', 'history.json'), '{"keep":true}\n');

  writeLaunchEnv({ REL_AI_MCP_PORT: '3333', REL_AI_MCP_TOKEN: 'local-token', REL_AI_MCP_TUNNEL_ID: 'tunnel_12345678' }, { replace: true });
  writeLaunchEnv({ REL_AI_MCP_PORT: '3334', REL_AI_MCP_TOKEN: 'local-token-2', REL_AI_MCP_TUNNEL_ID: 'tunnel_12345678' }, { replace: true });
  writeConnectionProfile({ host: '127.0.0.1', tunnelId: 'tunnel_12345678' }, { replace: true });
  writeConnectionProfile({ host: '127.0.0.1', tunnelId: 'tunnel_87654321' }, { replace: true });

  assert.equal(readLaunchEnv().REL_AI_MCP_TOKEN, 'local-token-2');
  assert.equal(readConnectionProfile().tunnelId, 'tunnel_87654321');
  assert.equal(fs.existsSync(path.join(root, '.env.bak')), true);
  assert.equal(fs.existsSync(path.join(root, 'connection.json.bak')), true);

  assert.deepEqual(clearConnectionState(), { ok: true });
  assert.deepEqual(readLaunchEnv(), {});
  assert.deepEqual(readConnectionProfile(), {});
  assert.equal(fs.existsSync(path.join(root, '.env.bak')), false);
  assert.equal(fs.existsSync(path.join(root, 'connection.json.bak')), false);
  assert.equal(fs.existsSync(path.join(root, 'config.json')), true, 'logout with kept data must preserve Rel.AI configuration');
  assert.equal(fs.existsSync(path.join(root, 'sessions', 'history.json')), true, 'logout with kept data must preserve task history');
} finally {
  if (previousStateDir === undefined) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Connection-only logout state clearing tests passed.');
