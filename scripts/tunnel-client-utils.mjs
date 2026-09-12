import { normalizeTargetArch } from './platform-architecture.mjs';

function normalizeTunnelClientArch(value) {
  try { return normalizeTargetArch(value); }
  catch {
    const normalized = String(value || '').trim().toLowerCase();
    throw new Error(`Unsupported tunnel-client architecture: ${normalized || '(empty)'}`);
  }
}

function resolveTunnelClientPlatformSpec(manifest, platform, arch) {
  const platformSpec = manifest.platforms?.[platform];
  return platformSpec?.architectures?.[arch] || platformSpec;
}

function assertTunnelClientManifest(value) {
  if (!/^\d+\.\d+\.\d+$/.test(String(value.version || ''))) throw new Error('Tunnel-client manifest version is invalid.');
  if (value.releaseTag !== `v${value.version}`) throw new Error('Tunnel-client manifest releaseTag must match version.');
  if (value.distribution !== 'full') throw new Error('Rel.AI requires the full OpenAI tunnel-client distribution.');
  if (!String(value.baseUrl || '').endsWith(`/v${value.version}`)) throw new Error('Tunnel-client manifest baseUrl must be pinned to its release version.');
}

export { assertTunnelClientManifest, normalizeTunnelClientArch, resolveTunnelClientPlatformSpec };
