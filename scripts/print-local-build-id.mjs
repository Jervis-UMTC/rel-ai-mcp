import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIdFromFingerprint, normalizeBuildProvenance } from '../src/buildProvenance.js';
import { electronPlatformSpec, normalizeElectronArch, normalizeElectronPlatform } from './electron-platform.mjs';
import { resolveCurrentUnpacked } from './current-unpacked.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const platform = normalizeElectronPlatform(valueAfter(argv, '--platform', process.platform));
const arch = normalizeElectronArch(process.env.REL_AI_TARGET_ARCH || process.arch);

try {
  const packageDirectory = resolveCurrentUnpacked(root, { platform, allowBuildCheck: true });
  const spec = electronPlatformSpec(platform, arch);
  const provenancePath = path.join(packageDirectory, spec.resourcesDirectory, 'build-provenance.json');
  const provenance = normalizeBuildProvenance(JSON.parse(fs.readFileSync(provenancePath, 'utf8')));
  if (!provenance) throw new Error('Local Electron package does not contain valid build identity metadata. Rebuild it with npm run electron:build.');
  const buildId = buildIdFromFingerprint(provenance.sourceFingerprint);
  console.log(`Rel.AI MCP v${provenance.version} (${buildId})`);
  console.log(`Built: ${provenance.builtAt}`);
  console.log(provenance.dirty ? 'Source: local changes included' : 'Source: clean checkout');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function valueAfter(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}
