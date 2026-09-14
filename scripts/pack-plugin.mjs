import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function packPlugin({ rootDir = repositoryRoot, destination = path.join(repositoryRoot, 'dist') } = {}) {
  const root = path.resolve(rootDir);
  const outputDirectory = path.resolve(destination);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-plugin-pack-'));

  try {
    for (const entry of manifest.files || []) copyPackageEntry(root, stagingRoot, entry);
    const publishManifest = { ...manifest };
    delete publishManifest.overrides;
    const bundledRuntime = bundledRuntimeDependencies(root, manifest);
    publishManifest.dependencies = { ...manifest.dependencies, ...Object.fromEntries(bundledRuntime) };
    publishManifest.bundleDependencies = [...bundledRuntime.keys()].sort();
    fs.writeFileSync(path.join(stagingRoot, 'package.json'), `${JSON.stringify(publishManifest, null, 2)}\n`);

    stageBundledDependencies(root, stagingRoot, bundledRuntime);
    fs.mkdirSync(outputDirectory, { recursive: true });

    const npmCli = resolveNpmCli();
    if (!npmCli) throw new Error('Could not locate the npm CLI required for plugin packaging.');
    const result = spawnSync(process.execPath, [
      npmCli,
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination', outputDirectory
    ], {
      cwd: stagingRoot,
      encoding: 'utf8',
      timeout: 10 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      windowsHide: true
    });
    if (result.error) throw new Error(`Plugin package could not start: ${result.error.message}`, { cause: result.error });
    if (result.signal) throw new Error(`Plugin package was terminated by ${result.signal}.`);
    if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || `npm pack failed with exit code ${result.status || 1}.`).trim());

    const parsed = JSON.parse(result.stdout || '[]');
    const metadata = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    if (!metadata?.filename) throw new Error(`npm pack returned no artifact metadata: ${result.stdout || ''}`);
    return { ...metadata, artifactPath: path.join(outputDirectory, metadata.filename) };
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function copyPackageEntry(root, stagingRoot, rawEntry) {
  const relative = String(rawEntry || '').replace(/[\\/]+$/, '');
  if (!relative) return;
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) throw new Error(`Plugin package source is missing: ${relative}`);
  const target = path.join(stagingRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true, verbatimSymlinks: true });
}

function bundledRuntimeDependencies(root, manifest) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const packages = lock.packages || {};
  const queue = [];
  const seen = new Set();
  const bundled = new Map();
  for (const dependency of manifest.bundleDependencies || []) {
    const packagePath = resolveLockPackage('', dependency, packages);
    if (packagePath) queue.push(packagePath);
  }

  while (queue.length > 0) {
    const packagePath = queue.shift();
    if (!packagePath || seen.has(packagePath)) continue;
    seen.add(packagePath);
    const entry = packages[packagePath];
    if (!entry) continue;

    if (isTopLevelPackagePath(packagePath)) {
      const name = lockPackageName(packagePath, entry);
      const installedManifest = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
      if (fs.existsSync(installedManifest)) bundled.set(name, String(entry.version || '*'));
    }

    const dependencies = {
      ...(entry.dependencies || {}),
      ...(entry.optionalDependencies || {}),
      ...(entry.peerDependencies || {})
    };
    for (const dependency of Object.keys(dependencies)) {
      const dependencyPath = resolveLockPackage(packagePath, dependency, packages);
      if (dependencyPath) queue.push(dependencyPath);
    }
  }
  return bundled;
}

function resolveLockPackage(packagePath, dependency, packages) {
  if (packagePath) {
    let cursor = packagePath;
    while (true) {
      const nested = `${cursor}/node_modules/${dependency}`;
      if (packages[nested]) return nested;
      const marker = cursor.lastIndexOf('/node_modules/');
      if (marker < 0) break;
      cursor = cursor.slice(0, marker);
    }
  }
  const topLevel = `node_modules/${dependency}`;
  return packages[topLevel] ? topLevel : '';
}

function isTopLevelPackagePath(packagePath) {
  return packagePath.startsWith('node_modules/')
    && !packagePath.slice('node_modules/'.length).includes('/node_modules/');
}

function lockPackageName(packagePath, entry) {
  if (entry?.name) return String(entry.name);
  const relative = packagePath.slice('node_modules/'.length);
  const parts = relative.split('/');
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function stageBundledDependencies(root, stagingRoot, bundledRuntime) {
  const installedModules = path.join(root, 'node_modules');
  if (!fs.existsSync(installedModules)) throw new Error('Plugin packaging requires installed root dependencies. Run npm install first.');
  for (const dependency of bundledRuntime.keys()) {
    const source = path.join(installedModules, ...dependency.split('/'));
    if (!fs.existsSync(source)) continue;
    const target = path.join(stagingRoot, 'node_modules', ...dependency.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true, dereference: true });
  }
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  return candidates.map(value => String(value || '')).find(value => value && fs.existsSync(value)) || '';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const destinationIndex = process.argv.indexOf('--destination');
    const destination = destinationIndex >= 0 ? process.argv[destinationIndex + 1] : path.join(repositoryRoot, 'dist');
    const metadata = packPlugin({ destination });
    console.log(JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { packPlugin };
