import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DASHBOARD_LIVE_EVENTS,
  DASHBOARD_LIVE_EVENT_TYPES,
  createEmptyDashboardRevisions
} from '../src/contracts/events.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'ui', 'generated', 'events-contract.js');
const check = process.argv.includes('--check');
const output = renderEventsContract();

if (check) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== output) {
    console.error('Generated UI event contract is stale. Run node scripts/generate-ui-contracts.mjs.');
    process.exitCode = 1;
  }
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output, 'utf8');
}

function renderEventsContract() {
  const revisions = createEmptyDashboardRevisions();
  return `// Generated from src/contracts/events.ts. Do not edit by hand.\n` +
    `export const DASHBOARD_LIVE_EVENTS = Object.freeze(${JSON.stringify(DASHBOARD_LIVE_EVENTS, null, 2)});\n\n` +
    `export const DASHBOARD_LIVE_EVENT_TYPES = Object.freeze(${JSON.stringify(DASHBOARD_LIVE_EVENT_TYPES, null, 2)});\n\n` +
    `export function createEmptyDashboardRevisions() {\n  return ${JSON.stringify(revisions)};\n}\n`;
}
