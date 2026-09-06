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
  requestTimeoutMs: 100
});

try {
  await client.start();
  const cancelled = new Promise(resolve => {
    const remove = client.onNotification('test/cancelled', params => {
      remove();
      resolve(params);
    });
  });

  await assert.rejects(
    () => client.request('test/slow', {}, { timeoutMs: 100 }),
    /request timed out: test\/slow/
  );
  assert.equal(client.pending.size, 0, 'timed-out LSP requests must be removed from the pending request map');
  assert.deepEqual(await withTimeout(cancelled, 1_000), { id: 1 }, 'request timeout must notify the server with $/cancelRequest');

  const controller = new AbortController();
  const aborted = new Promise(resolve => {
    const remove = client.onNotification('test/cancelled', params => {
      remove();
      resolve(params);
    });
  });
  const request = client.request('test/abort', {}, { signal: controller.signal, timeoutMs: 1_000 });
  controller.abort();
  await assert.rejects(request, error => error?.name === 'AbortError');
  assert.equal(client.pending.size, 0, 'aborted LSP requests must be removed from the pending request map');
  assert.deepEqual(await withTimeout(aborted, 1_000), { id: 2 }, 'explicit abort must retain LSP cancellation semantics');

  console.log('LSP request timeout and abort cancellation cleanup passed.');
} finally {
  await client.stop().catch(() => {});
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
