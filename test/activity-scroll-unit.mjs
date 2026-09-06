import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const css = read('src/ui/styles/app.css');
const activityCss = read('src/ui/features/activity/styles.css');
const activity = read('src/ui/features/activity/react.js');

const tableWrapRule = css.match(/\.table-wrap\s*\{([^}]*)\}/)?.[1] || '';
const routeRootRule = css.match(/\.route-root\s*\{([^}]*)\}/)?.[1] || '';
const activityPageRule = activityCss.match(/\.activity-page\s*\{([^}]*)\}/)?.[1] || '';
const activityCardRule = activityCss.match(/\.activity-event-card\s*\{([^}]*)\}/)?.[1] || '';
const activityCardBodyRule = activityCss.match(/\.activity-event-card \.card-body\s*\{([^}]*)\}/)?.[1] || '';
const activityTableWrapRule = activityCss.match(/\.activity-event-card \.table-wrap\s*\{([^}]*)\}/)?.[1] || '';

assert.match(activity, /className:\s*'table-wrap'/, 'React Activity must render its event log inside the shared table wrapper');
assert.match(activity, /tableWrapRef\.current\.scrollLeft = 0/, 'filter changes may reset horizontal table position');
assert.doesNotMatch(activity, /tableWrapRef\.current\.scrollTop\s*=|\.scrollTop\s*=\s*0/, 'Activity filter/live updates must not reset vertical reading position');
assert.match(activity, /scrollIntoView\(\{ block: 'start', inline: 'nearest' \}\)/, 'only explicit stacked-inspector selection should scroll content into view');
assert.match(css, /\.main\s*\{[^}]*@apply flex min-w-0 w-full flex-col/, 'the main dashboard column must expose remaining height to route content');
assert.match(routeRootRule, /@apply flex min-w-0 flex-col/, 'route content must use a vertical flex layout');
assert.match(routeRootRule, /flex:\s*1 0 auto/, 'route content must claim unused dashboard height without shrinking long pages');
assert.match(activityPageRule, /min-height:\s*0/, 'Activity must be allowed to shrink within the available route height'); // rigidity-ok: flex overflow invariant
assert.match(activityPageRule, /flex:\s*1 1 0/, 'Activity must fill available route height while allowing internal scrolling'); // rigidity-ok: bounded route flex child
assert.match(activityCardRule, /@apply flex min-w-0 flex-col/, 'the event log card must lay out its header and body vertically');
assert.match(activityCardRule, /min-height:\s*0/, 'the event log card must allow its scroll panes to shrink'); // rigidity-ok: flex overflow invariant
assert.match(activityCardRule, /flex:\s*1 1 0/, 'the event log card must fill remaining Activity height without forcing outer-page overflow'); // rigidity-ok: bounded vertical flex child
assert.match(activityCardBodyRule, /flex:\s*1 0 auto/, 'the event log body must fill the card');
assert.match(activityTableWrapRule, /flex:\s*1 0 auto/, 'the event log table wrapper must fill the body');
assert.match(activityCss, /\.activity-event-card \.table-wrap\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/, 'the event log wrapper must span the full card width'); // rigidity-ok: semantic scroll-container invariant
assert.match(activityCss, /\.activity-event-card \.table-wrap\s*\{[^}]*overflow-x:\s*auto/, 'horizontal overflow must be contained by the Activity table wrapper');
assert.match(tableWrapRule, /overscroll-behavior-x:\s*contain/, 'horizontal table overscroll should remain contained');
assert.match(tableWrapRule, /overscroll-behavior-y:\s*auto/, 'vertical wheel and touch scrolling must chain to the Activity page');
assert.doesNotMatch(tableWrapRule, /overscroll-behavior:\s*contain/, 'the table wrapper must not trap vertical page scrolling');

console.log('Activity React page scroll regression test passed.');
