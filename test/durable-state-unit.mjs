import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DurableStateError, readJsonFile, readJsonFileAsync, writeJsonAtomic, writeJsonAtomicAsync } from '../src/durableState.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-durable-state-'));
const file = path.join(root, 'state.json');

try {
  // Load from outside the checkout so local node_modules cannot hide packaging omissions.
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const packaged = path.join(root, 'resources');
  fs.mkdirSync(path.join(packaged, 'src'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'src/durableState.ts'), path.join(packaged, 'src/durableState.ts'));
  fs.writeFileSync(path.join(packaged, 'package.json'), '{"type":"module"}');
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'electron/package.json'), 'utf8'));
  const filters = manifest.build.extraResources.find(resource => resource.to === 'node_modules').filter;
  for (const name of ['write-file-atomic', 'signal-exit']) {
    const source = path.join(repo, 'node_modules', name);
    fs.cpSync(source, path.join(packaged, 'node_modules', name), {
      recursive: true,
      filter: candidate => {
        if (fs.statSync(candidate).isDirectory()) return true;
        const relative = path.relative(path.join(repo, 'node_modules'), candidate).replaceAll('\\', '/');
        return filters.some(pattern => !pattern.startsWith('!') && path.matchesGlob(relative, pattern))
          && !filters.some(pattern => pattern.startsWith('!') && path.matchesGlob(relative, pattern.slice(1)));
      }
    });
  }
  const packagedState = await import(pathToFileURL(path.join(packaged, 'src/durableState.ts')).href);
  const packagedFile = path.join(packaged, 'state.json');
  packagedState.writeJsonAtomic(packagedFile, { revision: 1 });
  assert.deepEqual(packagedState.readJsonFile(packagedFile), { revision: 1 });
  await packagedState.writeJsonAtomicAsync(packagedFile, { revision: 2 });
  assert.deepEqual(await packagedState.readJsonFileAsync(packagedFile), { revision: 2 });

  writeJsonAtomic(file, { revision: 1, value: 'first' }, { backup: true });
  assert.deepEqual(readJsonFile(file), { revision: 1, value: 'first' });

  writeJsonAtomic(file, { revision: 2, value: 'second' }, { backup: true });
  assert.deepEqual(readJsonFile(file), { revision: 2, value: 'second' });
  assert.deepEqual(readJsonFile(`${file}.bak`), { revision: 1, value: 'first' });

  const concurrentFile = path.join(root, 'concurrent.json');
  writeJsonAtomic(concurrentFile, { revision: 0 }, { backup: true });
  await Promise.all([
    writeJsonAtomicAsync(concurrentFile, { revision: 1 }, { backup: true, durable: false }),
    writeJsonAtomicAsync(concurrentFile, { revision: 2 }, { backup: true, durable: false })
  ]);
  assert.deepEqual(readJsonFile(concurrentFile), { revision: 2 });
  assert.deepEqual(
    readJsonFile(`${concurrentFile}.bak`),
    { revision: 1 },
    'concurrent saves must serialize the backup+primary transaction so the backup is the immediately previous revision'
  );

  fs.writeFileSync(file, '{truncated', 'utf8');
  let recovery = null;
  const recovered = readJsonFile(file, {
    backup: true,
    onRecovery: details => { recovery = details; }
  });
  assert.deepEqual(recovered, { revision: 1, value: 'first' });
  assert.equal(recovery.reason, 'malformed_json');
  assert.deepEqual(readJsonFile(file), recovered, 'backup recovery must restore the primary record');

  await writeJsonAtomicAsync(file, { revision: 3, value: 'async' }, { backup: true, durable: false });
  assert.deepEqual(readJsonFile(file), { revision: 3, value: 'async' });
  assert.deepEqual(await readJsonFileAsync(file), { revision: 3, value: 'async' });
  assert.deepEqual(readJsonFile(`${file}.bak`), recovered, 'async atomic writes must preserve the previous record when backup is requested');

  fs.writeFileSync(file, '{}', 'utf8');
  assert.throws(
    () => readJsonFile(file, { validate: value => Number.isInteger(value.revision) }),
    error => error instanceof DurableStateError && error.code === 'DURABLE_STATE_READ_FAILED'
  );

  assert.deepEqual(
    fs.readdirSync(root).filter(name => /\.(?:tmp|old)$/.test(name)),
    [],
    'atomic state writes must not leave temporary promotion artifacts'
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Durable state atomic write, backup recovery, validation, and cleanup tests passed.');
