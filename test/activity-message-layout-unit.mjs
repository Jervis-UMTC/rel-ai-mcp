import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/features/activity/styles.css', 'utf8');
const react = fs.readFileSync('src/ui/features/activity/react.js', 'utf8');

assert.match(react, /h\('colgroup',[\s\S]{0,260}activity-col-time[\s\S]{0,180}activity-col-message/, 'React activity table must keep the canonical time + activity columns');
assert.doesNotMatch(react, /activity-col-(?:tool|task|status|action)/, 'tool, task, status, and action belong in Activity metadata instead of duplicate table columns');
assert.match(react, /activity-row-meta[\s\S]{0,500}StatusPill[\s\S]{0,300}activity-row-action[\s\S]{0,300}activity-row-task[\s\S]{0,300}activity-row-project/, 'Activity metadata must retain status, action, task, and project context');
assert.match(css, /\.activity-table\s*\{[^}]*table-layout:\s*fixed/s, 'Activity table must use a stable fixed layout');
assert.match(css, /\.activity-col-time\s*\{[^}]*width:\s*\d+px/s, 'Time must keep a bounded fixed-width column');
assert.match(css, /\.activity-col-message\s*\{[^}]*width:\s*auto/s, 'Activity content must consume the remaining width');
assert.doesNotMatch(css, /\.activity-col-message\s*\{[^}]*width:\s*calc\(/s, 'Activity width must not depend on brittle calc chains');
assert.match(css, /\.activity-message-copy\s*\{[^}]*min-width:/s, 'message text must retain an explicit readable minimum width');
assert.match(css, /@media\s*\(max-width:[^)]+\)[\s\S]*\.activity-time-column[\s\S]*display:\s*none/s, 'the narrowest responsive layout must yield the lower-priority time column');
assert.match(css, /@media\s*\(max-width:[^)]+\)[\s\S]*\.activity-col-message\s*\{[^}]*width:\s*100%/s, 'the Activity column must expand to full width when time is hidden'); // rigidity-ok: full width is the responsive contract after the time column is hidden.

console.log('Activity message layout invariants passed.');
