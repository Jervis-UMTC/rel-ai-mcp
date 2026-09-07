import assert from 'node:assert/strict';

import { LspClient } from '../src/codeIntelligence/lspClient.js';

const serverSource = String.raw`
let buffer = Buffer.alloc(0);
function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(Buffer.concat([
    Buffer.from('Content-Length: ' + body.length + '\r\n\r\n', 'ascii'),
    body
  ]));
}
function dispatch(message) {
  if (message?.method === '$/cancelRequest') {
    send({ jsonrpc: '2.0', method: 'test/cancelled', params: { id: message.params?.id } });
    return;
  }
  if (message?.method === 'test/ping' && Object.hasOwn(message, 'id')) {
    send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
    return;
  }
  if (message?.method === 'test/crash' && Object.hasOwn(message, 'id')) {
    process.exit(7);
  }
  if (message?.method === 'shutdown' && Object.hasOwn(message, 'id')) {
    send({ jsonrpc: '2.0', id: message.id, result: null });
    return;
  }
  if (message?.method === 'exit') process.exit(0);
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(buffer.subarray(start, start + length).toString('utf8'));
    buffer = buffer.subarray(start + length);
    dispatch(message);
  }
});
`;

const client = new LspClient({
  executable: process.execPath,
  argv: ['--input-type=module', '-e', serverSource],
  cwd: process.cwd(),
  name: 'fake-language-server',
  requestTimeoutMs: 2_000
});

try {
  await client.start();
  assert.equal(client.state, 'running');

  const timedOutCancellation = nextCancellation(client);
  await assert.rejects(
    () => client.request('test/slow', {}, { timeoutMs: 100 }),
    /request timed out: test\/slow/
  );
  const timedOut = await withTimeout(timedOutCancellation, 5_000);
  assert.ok(Number.isInteger(timedOut?.id), 'request timeout must notify the server with $/cancelRequest');
  assert.deepEqual(await client.request('test/ping', {}), { ok: true }, 'a timed-out request must not poison later requests');

  const controller = new AbortController();
  const abortedCancellation = nextCancellation(client);
  const request = client.request('test/abort', {}, { signal: controller.signal, timeoutMs: 1_000 });
  controller.abort();
  await assert.rejects(request, error => error?.name === 'AbortError');
  const aborted = await withTimeout(abortedCancellation, 5_000);
  assert.ok(Number.isInteger(aborted?.id), 'explicit abort must notify the server with $/cancelRequest');
  assert.notEqual(aborted.id, timedOut.id, 'distinct requests must retain distinct JSON-RPC cancellation identities');
  assert.deepEqual(await client.request('test/ping', {}), { ok: true }, 'an aborted request must not poison later requests');

  const interrupted = assert.rejects(
    client.request('test/slow', {}, { timeoutMs: 5_000 }),
    /stopped|closed|exited/i
  );
  await client.stop();
  await interrupted;
  assert.equal(client.state, 'stopped');

  await client.start();
  assert.equal(client.state, 'running');
  assert.deepEqual(await client.request('test/ping', {}), { ok: true }, 'a stopped client must be restartable');

  await assert.rejects(() => client.request('test/crash', {}, { timeoutMs: 5_000 }));
  assert.equal(client.state, 'failed', 'an unexpected language-server exit must become an explicit failed state');
  assert.ok(client.lastError, 'language-server failure state must retain a useful error');

  console.log('LSP lifecycle, timeout, cancellation, restart, and failure-state behavior passed.');
} finally {
  await client.stop().catch(() => {});
}

function nextCancellation(client) {
  return new Promise(resolve => {
    const remove = client.onNotification('test/cancelled', params => {
      remove();
      resolve(params);
    });
  });
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for fake language-server cancellation.')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
