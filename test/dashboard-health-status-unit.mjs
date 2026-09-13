import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { statusPillClass } from '../src/ui/status-tone.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sessionsReact = fs.readFileSync(path.join(root, 'src/ui/features/sessions/react.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'public/dashboard.js'), 'utf8');

assert.equal(statusPillClass('succeeded'), 'ok', 'succeeded must use the canonical success pill class');
assert.match(
  sessionsReact,
  /const pillClass = state\?\.pillClass \|\| statusPillClass\(status\)/,
  'task activity pills must fall back to the canonical status class when a caller does not provide one'
);
assert.match(
  dashboard,
  /_routerReady && _liveState === 'live'[\s\S]{0,180}request timed out[\s\S]{0,80}return data/,
  'a dashboard snapshot timeout must not report Rel.AI as disconnected while the live event stream is healthy'
);

console.log('Dashboard health and status presentation regressions passed.');
