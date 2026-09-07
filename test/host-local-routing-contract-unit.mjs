import assert from 'node:assert/strict';

import { STATIC_CONTEXT } from '../src/context/static-context.js';
import { getPublicToolSchemas } from '../src/tools/schema.js';

const publicTools = new Map(getPublicToolSchemas().map(tool => [tool.name, tool]));
const descriptions = new Map([...publicTools].map(([name, tool]) => [name, String(tool.description || '')]));

const orderedRouting = [
  'AI-host native capability',
  'AI-host plugin/connector',
  'Rel.AI structured local capability',
  'Rel.AI local browser',
  'Rel.AI computer control'
];
let previousIndex = -1;
for (const step of orderedRouting) {
  const index = STATIC_CONTEXT.indexOf(step);
  assert.ok(index > previousIndex, `${step} must appear in canonical routing order`);
  previousIndex = index;
}

for (const hostOwned of [
  'general reasoning',
  'public-web/current-news research',
  'image generation',
  'ordinary writing',
  'uploaded host files',
  'Gmail',
  'Calendar'
]) {
  assert.match(STATIC_CONTEXT, new RegExp(escapeRegExp(hostOwned), 'i'), `${hostOwned} must remain host-owned`);
}

for (const localOwned of [
  'files/repositories',
  'Git state',
  'CLI/processes',
  'localhost/LAN/intranet',
  'native apps',
  'browser sessions',
  'uploads/downloads',
  'open/reveal'
]) {
  assert.match(STATIC_CONTEXT, new RegExp(escapeRegExp(localOwned), 'i'), `${localOwned} must remain inside the Rel.AI local boundary`);
}

const read = descriptions.get('relai_read');
assert.match(read, /authorized local workspace.*ordinary folder or a Git repository/i);
assert.match(read, /already uploaded to the AI host.*host-side inputs/i);
assert.match(read, /file still lives on the user's machine|must be transferred from it/i);

const edit = descriptions.get('relai_edit');
assert.match(edit, /authorized local workspace.*ordinary folders and repositories/i);
assert.match(edit, /Host-side document authoring remains host-owned/i);
assert.match(edit, /native ChatGPT file import.*host-generated artifact.*stored locally/i);

const ui = descriptions.get('relai_ui');
assert.match(ui, /bounded QA evidence/i);
assert.match(ui, /use relai_browser for general machine-local browsing/i);

const browser = descriptions.get('relai_browser');
assert.match(browser, /browser running on the user's local machine/i);
assert.match(browser, /localhost or LAN\/intranet resources/i);
assert.match(browser, /local VPN access/i);
assert.match(browser, /machine-local authenticated browser state/i);
assert.match(browser, /upload from or download into an authorized local workspace/i);
assert.match(browser, /Do not use it merely to research the public internet/i);
const browserActions = publicTools.get('relai_browser')?.inputSchema?.properties?.action?.enum || [];
for (const action of ['status', 'start', 'tabs', 'navigate', 'upload', 'download', 'stop']) {
  assert.ok(browserActions.includes(action), `relai_browser must expose ${action}`);
}

const desktop = descriptions.get('relai_desktop');
assert.match(desktop, /structured local desktop actions/i);
assert.match(desktop, /Prefer this over relai_computer/i);

const computer = descriptions.get('relai_computer');
assert.match(computer, /final fallback for local desktop interaction/i);
assert.match(computer, /structured local capabilities.*local browser surface/i);
assert.match(computer, /not a substitute for host-native reasoning, public web search, image generation, uploaded-file analysis, or cloud connectors/i);

const decisions = [
  ['Research today\'s AI news', /public-web\/current-news research/i, /Do not use.*public/i],
  ['Check Gmail', /Gmail.*remain host-owned/i, null],
  ['Run tests in C:\\repo', /CLI\/processes/i, null],
  ['Read D:\\contract.pdf', /machine-local access: configured files\/repositories/i, null],
  ['Open our internal 192.168.x.x dashboard', /localhost\/LAN\/intranet/i, /browser running on the user's local machine/i],
  ['Save a host-generated artifact into the local workspace', /configured files\/repositories/i, /native ChatGPT file import.*host-generated artifact.*stored locally/i],
  ['Change a setting in a native desktop application', /native apps/i, /Prefer this over relai_computer/i]
];
for (const [scenario, contextPattern, toolPattern] of decisions) {
  assert.match(STATIC_CONTEXT, contextPattern, `${scenario} must be decidable from the canonical host/local contract`);
  if (toolPattern) {
    const combinedToolDescriptions = `${ui}\n${browser}\n${edit}\n${desktop}\n${computer}`;
    assert.match(combinedToolDescriptions, toolPattern, `${scenario} must be supported by public tool descriptions`);
  }
}

console.log('Host/local routing contract keeps host-native work out of Rel.AI and orders local structured/browser/computer fallbacks.');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
