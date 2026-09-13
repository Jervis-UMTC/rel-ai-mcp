import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { importNativeArtifact, normalizeReference, validateDownloadUrl } from '../src/artifactIntake.js';
import { planEdit } from '../src/executionPlanner.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-artifact-intake-'));
const repo = path.join(root, 'repo');
const config = { stateDir: path.join(root, 'state') };
const workspace = { alias: 'app', path: repo };
const originalFetch = globalThis.fetch;
fs.mkdirSync(repo, { recursive: true });

const file = {
  download_url: 'https://files.oaiusercontent.com/download/test-file',
  file_id: 'file_test_123',
  file_name: 'asset.bin',
  mime_type: 'application/octet-stream',
  size: 5
};

try {
  assert.equal(validateDownloadUrl(file.download_url), file.download_url);
  assert.throws(() => validateDownloadUrl('http://files.oaiusercontent.com/test'), /trusted OpenAI file host/i);
  assert.throws(() => validateDownloadUrl('https://example.com/test'), /trusted OpenAI file host/i);
  assert.throws(() => normalizeReference({ ...file, extra: true }), /malformed/i);

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      status: 200,
      headers: { 'content-length': '5', 'content-type': 'application/octet-stream' }
    });
  };

  const dryRun = await importNativeArtifact(workspace, config, { file, path: 'public/dry.bin', dryRun: true });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.changed, false);
  assert.equal(fetchCalls, 0, 'artifact dry-run must not perform network IO');
  assert.equal(fs.existsSync(path.join(repo, 'public', 'dry.bin')), false);

  const imported = await importNativeArtifact(workspace, config, { file, path: 'public/asset.bin' });
  assert.equal(fetchCalls, 1);
  assert.equal(imported.changed, true);
  assert.equal(imported.bytes, 5);
  assert.match(imported.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual([...fs.readFileSync(path.join(repo, 'public', 'asset.bin'))], [1, 2, 3, 4, 5]);

  const throughEdit = await planEdit(workspace, config, {
    path: 'public/via-edit.bin',
    file: {
      download_url: file.download_url,
      file_id: file.file_id,
      file_name: file.file_name,
      mime_type: file.mime_type
    }
  });
  assert.equal(throughEdit.changed, true);
  assert.equal(throughEdit.bytes, 5);
  assert.deepEqual([...fs.readFileSync(path.join(repo, 'public', 'via-edit.bin'))], [1, 2, 3, 4, 5]);

  const largeBytes = Buffer.alloc((2 * 1024 * 1024) + 37, 0xa5);
  const largeFile = {
    ...file,
    file_id: 'file_large_123',
    file_name: 'large.bin',
    size: largeBytes.length
  };
  globalThis.fetch = async () => new Response(largeBytes, {
    status: 200,
    headers: { 'content-length': String(largeBytes.length), 'content-type': 'application/octet-stream' }
  });
  const largeImported = await importNativeArtifact(workspace, config, { file: largeFile, path: 'public/large.bin' });
  assert.equal(largeImported.bytes, largeBytes.length, 'multi-megabyte native artifact import must preserve the complete byte count');
  assert.equal(largeImported.sha256, crypto.createHash('sha256').update(largeBytes).digest('hex'), 'large binary import must preserve the exact content hash');
  assert.deepEqual(fs.readFileSync(path.join(repo, 'public', 'large.bin')), largeBytes, 'large binary import must preserve exact bytes');

  let traversalFetchCalls = 0;
  globalThis.fetch = async () => {
    traversalFetchCalls += 1;
    throw new Error('unexpected traversal fetch');
  };
  await assert.rejects(
    () => importNativeArtifact(workspace, config, { file, path: '../escape.bin' }),
    'artifact import must reject path traversal before network IO'
  );
  assert.equal(traversalFetchCalls, 0, 'path traversal rejection must happen before downloading the artifact');
  assert.equal(fs.existsSync(path.join(root, 'escape.bin')), false);

  const cancelController = new AbortController();
  let transferSignal;
  globalThis.fetch = async (_url, init = {}) => {
    transferSignal = init.signal;
    let sent = false;
    return new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
      },
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new Uint8Array([9, 8, 7, 6]));
          return;
        }
        cancelController.abort(new Error('artifact import cancelled by test'));
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' }
    });
  };
  await assert.rejects(
    () => planEdit(workspace, config, {
      path: 'public/cancelled.bin',
      file: {
        download_url: file.download_url,
        file_id: 'file_cancel_123',
        file_name: 'cancelled.bin',
        mime_type: file.mime_type
      }
    }, { signal: cancelController.signal }),
    /artifact import cancelled by test/,
    'request cancellation must stop a native artifact import'
  );
  assert.equal(transferSignal?.aborted, true, 'artifact fetch must receive the combined request cancellation signal');
  assert.equal(fs.existsSync(path.join(repo, 'public', 'cancelled.bin')), false, 'cancelled artifact imports must remove partial files');

  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), {
    status: 200,
    headers: { 'content-length': '5', 'content-type': 'application/octet-stream' }
  });
  await assert.rejects(
    () => importNativeArtifact(workspace, config, { file, path: 'public/asset.bin' }),
    /already exists/i,
    'artifact import must never overwrite an existing destination'
  );

  globalThis.fetch = async () => new Response(new Uint8Array([1, 2]), {
    status: 200,
    headers: { 'content-length': '2' }
  });
  await assert.rejects(
    () => importNativeArtifact(workspace, config, { file, path: 'public/wrong-size.bin' }),
    /metadata did not match/i
  );
  assert.equal(fs.existsSync(path.join(repo, 'public', 'wrong-size.bin')), false);

  console.log('Native ChatGPT artifact validation, relai_edit routing, streamed import, size checks, and no-overwrite tests passed.');
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(root, { recursive: true, force: true });
}
