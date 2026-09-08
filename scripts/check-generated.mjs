import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, mergeConfig } from 'vite';
import viteConfig from '../vite.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedFiles = Object.freeze(['dashboard-app.js', 'dashboard-react.js', 'dashboard.css']);
const generatedDirectories = Object.freeze(['dashboard-chunks', 'dashboard-assets']);
const publicRoot = process.env.REL_AI_GENERATED_PUBLIC_ROOT
  ? path.resolve(process.env.REL_AI_GENERATED_PUBLIC_ROOT)
  : path.join(root, 'public');

try {
  verifyColorTokens();
  verifyUiContracts();
  await verifyDashboardAssets(publicRoot);
  console.log('Generated dashboard assets are current.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function verifyColorTokens() {
  verifyGenerator('generate-color-tokens.mjs', 'Generated color tokens are stale. Run npm run generate:color-tokens.');
}

function verifyUiContracts() {
  verifyGenerator('generate-ui-contracts.mjs', 'Generated UI contracts are stale. Run node scripts/generate-ui-contracts.mjs.');
}

function verifyGenerator(name, message) {
  const script = path.join(root, 'scripts', name);
  const result = spawnSync(process.execPath, [script, '--check'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${name} verification was terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(message);
}

async function verifyDashboardAssets(currentPublicRoot) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-vite-'));
  try {
    await build(mergeConfig(viteConfig, {
      build: {
        outDir: tempRoot,
        emptyOutDir: true
      }
    }));
    const current = readGeneratedAssets(currentPublicRoot);
    const generated = readGeneratedAssets(tempRoot);
    const currentNames = [...current.keys()].sort();
    const generatedNames = [...generated.keys()].sort();
    if (currentNames.length !== generatedNames.length || currentNames.some((name, index) => name !== generatedNames[index])) {
      throw staleDashboardError();
    }
    for (const name of generatedNames) {
      if (!current.get(name)?.equals(generated.get(name))) throw staleDashboardError();
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function readGeneratedAssets(publicRoot) {
  const files = new Map();
  for (const name of generatedFiles) {
    const file = path.join(publicRoot, name);
    if (fs.existsSync(file)) files.set(name, fs.readFileSync(file));
  }
  for (const directory of generatedDirectories) {
    const directoryRoot = path.join(publicRoot, directory);
    for (const file of listFiles(directoryRoot)) {
      files.set(path.relative(publicRoot, file).replaceAll('\\', '/'), fs.readFileSync(file));
    }
  }
  return files;
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function staleDashboardError() {
  return new Error('Generated dashboard assets are stale. Run npm run build:frontend and keep public/dashboard-app.js, public/dashboard-react.js, public/dashboard.css, and generated dashboard chunks with the source change.');
}
