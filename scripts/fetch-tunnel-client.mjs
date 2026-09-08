import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'tunnel-client', 'manifest.json'), 'utf8'));
assertManifestContract(manifest);
const requested = (process.env.TUNNEL_CLIENT_PLATFORMS || process.platform).split(',').map(value => value.trim()).filter(Boolean);
const targetArch = normalizeArch(process.env.REL_AI_TARGET_ARCH || process.arch);
for (const platform of requested) await fetchPlatform(platform);

async function fetchPlatform(platform) {
  const spec = resolvePlatformSpec(platform, targetArch);
  if (!spec) throw new Error(`Unsupported tunnel-client platform/architecture: ${platform}/${targetArch}`);
  const response = await fetch(`${manifest.baseUrl}/${spec.archive}`, { redirect: 'follow' });
  if (!response.ok) throw new Error(`OpenAI tunnel-client download failed with HTTP ${response.status}.`);
  const archiveData = Buffer.from(await response.arrayBuffer());
  verifyBuffer(archiveData, spec.archiveSha256, spec.archiveSize, `${platform} archive`);
  const data = await readZipEntry(archiveData, spec.archiveEntry);
  verifyBuffer(data, spec.sha256, spec.size, `${platform} executable`);

  const targetDir = path.join(root, 'vendor', 'tunnel-client', platform);
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, spec.file);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, data, { mode: 0o755 });
    if (platform !== 'win32') fs.chmodSync(temporary, 0o755);
    fs.rmSync(target, { force: true, maxRetries: 5, retryDelay: 50 });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  console.log(`Verified OpenAI tunnel-client ${manifest.version} for ${platform}/${targetArch}: ${spec.sha256}`);
}

function readZipEntry(buffer, expectedEntry) {
  const expected = normalizeArchiveEntry(expectedEntry);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }
      let settled = false;
      const finish = (error, data) => {
        if (settled) return;
        settled = true;
        try { zipFile.close(); } catch {}
        if (error) reject(error);
        else resolve(data);
      };
      zipFile.once('error', error => finish(error));
      zipFile.once('end', () => finish(new Error(`Downloaded archive did not contain exact entry ${expected}.`)));
      zipFile.on('entry', entry => {
        const actual = normalizeArchiveEntry(entry.fileName);
        if (actual !== expected) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            finish(streamError);
            return;
          }
          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.once('error', error => finish(error));
          stream.once('end', () => finish(null, Buffer.concat(chunks)));
        });
      });
      zipFile.readEntry();
    });
  });
}

function resolvePlatformSpec(platform, arch) {
  const platformSpec = manifest.platforms[platform];
  return platformSpec?.architectures?.[arch] || platformSpec;
}

function normalizeArchiveEntry(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../')) throw new Error(`Invalid tunnel-client archive entry: ${value || '(empty)'}`);
  return normalized;
}

function normalizeArch(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['x64', 'amd64', 'x86_64'].includes(normalized)) return 'x64';
  if (['arm64', 'aarch64'].includes(normalized)) return 'arm64';
  throw new Error(`Unsupported tunnel-client architecture: ${normalized || '(empty)'}`);
}

function assertManifestContract(value) {
  if (!/^\d+\.\d+\.\d+$/.test(String(value.version || ''))) throw new Error('Tunnel-client manifest version is invalid.');
  if (value.releaseTag !== `v${value.version}`) throw new Error('Tunnel-client manifest releaseTag must match version.');
  if (value.distribution !== 'full') throw new Error('Rel.AI requires the full OpenAI tunnel-client distribution.');
  if (!String(value.baseUrl || '').endsWith(`/v${value.version}`)) throw new Error('Tunnel-client manifest baseUrl must be pinned to its release version.');
}

function verifyBuffer(data, expectedHash, expectedSize, label) {
  if (expectedSize !== undefined && data.length !== Number(expectedSize)) throw new Error(`${label} size mismatch: expected ${expectedSize}, got ${data.length}.`);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  if (hash !== String(expectedHash || '').toLowerCase()) throw new Error(`${label} SHA-256 mismatch: expected ${expectedHash}, got ${hash}.`);
}
