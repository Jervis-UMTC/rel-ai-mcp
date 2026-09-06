import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invalidateDerivedReleaseEvidence, releaseArtifactNames } from '../scripts/release-artifacts.mjs';
import { verifyPlatformUpdaterArtifacts, verifyUpdaterArtifacts } from '../scripts/verify-updater-artifacts.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-updater-contract-'));
const installer = 'Rel.AI-MCP-Setup-9.8.7.exe';
const metadata = 'latest.yml';
const checksums = 'SHA256SUMS.txt';
const list = path.join(root, 'release-assets.txt');
const bytes = Buffer.from('canonical installer bytes');

function writeFixture({ listedInstaller = installer, metadataInstaller = installer, sha512Bytes = bytes, includeBlockmap = true, includeChecksum = true } = {}) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, listedInstaller), bytes);
  if (includeBlockmap) fs.writeFileSync(path.join(root, `${listedInstaller}.blockmap`), 'blockmap');
  const sha512 = crypto.createHash('sha512').update(sha512Bytes).digest('base64');
  fs.writeFileSync(path.join(root, metadata), `version: 9.8.7\nfiles:\n  - url: ${metadataInstaller}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${metadataInstaller}\nsha512: ${sha512}\n`);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(root, checksums), includeChecksum ? `${sha256}  ${listedInstaller}\n` : '');
  fs.writeFileSync(list, [listedInstaller, `${listedInstaller}.blockmap`, metadata, checksums].join('\n'));
}

const options = { directory: root, assetList: list, metadata, checksums };
try {
  writeFixture();
  const report = verifyUpdaterArtifacts(options);
  assert.deepEqual(report.referencedArtifacts, [installer]);

  writeFixture({ listedInstaller: 'renamed-installer.exe' });
  assert.throws(() => verifyUpdaterArtifacts(options), /exact basename/,
    'same bytes under a different filename must fail');

  writeFixture({ sha512Bytes: Buffer.from('different bytes') });
  assert.throws(() => verifyUpdaterArtifacts(options), /SHA-512 mismatch/);

  writeFixture({ includeBlockmap: false });
  assert.throws(() => verifyUpdaterArtifacts(options), /blockmap is missing/i);
  assert.deepEqual(verifyUpdaterArtifacts({ ...options, requireBlockmaps: false }).referencedArtifacts, [installer]);

  writeFixture({ includeChecksum: false });
  assert.throws(() => verifyUpdaterArtifacts(options), /does not include/);

  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const canonicalNames = releaseArtifactNames(packageJson.version);
  const canonicalBytes = Buffer.from('platform-local canonical updater bytes');
  const canonicalSha512 = crypto.createHash('sha512').update(canonicalBytes).digest('base64');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, canonicalNames.installer), canonicalBytes);
  fs.writeFileSync(path.join(root, canonicalNames.blockmap), 'blockmap');
  fs.writeFileSync(path.join(root, canonicalNames.metadata), `version: ${packageJson.version}\nfiles:\n  - url: ${canonicalNames.installer}\n    sha512: ${canonicalSha512}\n    size: ${canonicalBytes.length}\npath: ${canonicalNames.installer}\nsha512: ${canonicalSha512}\n`);
  assert.deepEqual(verifyPlatformUpdaterArtifacts({ directory: root, platform: 'win32' }).referencedArtifacts, [canonicalNames.installer],
    'platform-local Windows verification must validate updater metadata directly without a combined release asset list');
  fs.rmSync(path.join(root, canonicalNames.blockmap));
  assert.throws(() => verifyPlatformUpdaterArtifacts({ directory: root, platform: 'win32' }), /blockmap is missing/i);

  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, canonicalNames.linuxAppImage), canonicalBytes);
  fs.writeFileSync(path.join(root, canonicalNames.linuxMetadata), `version: ${packageJson.version}\nfiles:\n  - url: ${canonicalNames.linuxAppImage}\n    sha512: ${canonicalSha512}\n    size: ${canonicalBytes.length}\npath: ${canonicalNames.linuxAppImage}\nsha512: ${canonicalSha512}\n`);
  assert.deepEqual(verifyPlatformUpdaterArtifacts({ directory: root, platform: 'linux' }).referencedArtifacts, [canonicalNames.linuxAppImage],
    'platform-local Linux verification must validate updater metadata directly without unrelated platform bundles');

  writeFixture();
  fs.writeFileSync(path.join(root, 'sbom.cdx.json'), '{}\n');
  const invalidated = invalidateDerivedReleaseEvidence(root, '9.8.7').sort();
  assert.deepEqual(invalidated, [
    'SHA256SUMS.txt',
    'release-assets.txt',
    'sbom.cdx.json'
  ]);
  assert.equal(fs.existsSync(path.join(root, installer)), true);
  assert.equal(fs.existsSync(path.join(root, metadata)), true);
  assert.equal(fs.existsSync(path.join(root, checksums)), false);
  assert.equal(fs.existsSync(list), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Updater artifact exact-name and checksum contract tests passed.');
