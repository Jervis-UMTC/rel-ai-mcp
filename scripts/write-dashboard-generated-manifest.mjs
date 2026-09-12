import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeDashboardGeneratedManifest } from './dashboard-generated-integrity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');

writeDashboardGeneratedManifest(root, publicRoot);
console.log('Recorded dashboard generated-asset integrity.');
