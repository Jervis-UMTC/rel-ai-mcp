import { createMidsceneComputerAdapter } from './computer/midsceneAdapter.js';

const COMPUTER_ACTIONS = new Set([
  'status', 'displays', 'screenshot', 'move', 'click', 'double_click', 'right_click',
  'drag', 'scroll', 'type', 'key', 'hotkey'
]);
const MODIFIER_ALIASES = Object.freeze({
  ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', option: 'alt',
  cmd: 'command', command: 'command', meta: 'command', win: 'command', super: 'command'
});
const KEY_ALIASES = Object.freeze({
  return: 'enter', esc: 'escape', spacebar: 'space', del: 'delete',
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right'
});
const DEFAULT_SCROLL_DISTANCE = 700;
const MAX_TYPE_TEXT_BYTES = 64 * 1024;
const defaultComputerAdapter = createMidsceneComputerAdapter();
let inputQueue = Promise.resolve();

function computerControlSettings(config) {
  return Object.freeze({ enabled: config?.computerControl?.enabled === true });
}

function computerControlDisabledError() {
  const error = new Error('Computer control is disabled by the local Rel.AI setting. Do not retry this computer action or request MCP approval. Ask the user to enable Computer control in Rel.AI Settings > App, then retry after the setting is enabled.');
  error.name = 'ComputerControlDisabledError';
  error.code = 'COMPUTER_CONTROL_DISABLED';
  error.source = 'rel-ai-mcp-policy';
  error.operation = 'computer_control';
  error.retryable = false;
  error.requiresUserConfirmation = false;
  error.allowedAlternatives = ['Enable Computer control in Rel.AI Settings > App, then retry the requested computer action.'];
  return error;
}

async function readComputerStatus(config, context = {}) {
  const settings = computerControlSettings(config);
  const adapter = resolveAdapter(context);
  try {
    const environment = await adapter.environment();
    return {
      ok: true,
      action: 'status',
      enabled: settings.enabled,
      available: environment?.available === true,
      platform: String(environment?.platform || process.platform),
      engine: adapter.engine || '@midscene/computer',
      displays: Number(environment?.displays || 0),
      ...(environment?.error ? { message: `Computer control runtime is unavailable: ${environment.error}` } : {})
    };
  } catch (error) {
    return {
      ok: true,
      action: 'status',
      enabled: settings.enabled,
      available: false,
      platform: process.platform,
      engine: adapter.engine || '@midscene/computer',
      message: `Computer control runtime is unavailable: ${errorMessage(error)}`
    };
  }
}

async function runComputerAction(workspace, config, args = {}, context = {}) {
  const action = String(args.action || '').trim().toLowerCase();
  if (!COMPUTER_ACTIONS.has(action)) throw new Error(`Unsupported computer action: ${action || '(missing)'}.`);
  if (action === 'status') {
    return { ...(await readComputerStatus(config, context)), workspace: workspace.alias };
  }
  if (!computerControlSettings(config).enabled) throw computerControlDisabledError();

  const adapter = resolveAdapter(context);
  if (action === 'displays') {
    const displays = await adapter.listDisplays();
    return baseResult(workspace, action, { displays, count: displays.length, engine: adapter.engine || '@midscene/computer' });
  }
  if (action === 'screenshot') {
    const displayId = optionalDisplayId(args.displayId);
    const image = await adapter.screenshot(displayId);
    return baseResult(workspace, action, {
      ...(displayId ? { displayId } : {}),
      image,
      engine: adapter.engine || '@midscene/computer'
    });
  }
  return queueInput(() => executeInputAction(adapter, workspace, action, args));
}

async function executeInputAction(adapter, workspace, action, args) {
  const displayId = optionalDisplayId(args.displayId);

  if (action === 'move' || action === 'click' || action === 'double_click' || action === 'right_click') {
    const point = await resolveDisplayPoint(adapter, displayId, args.x, args.y, 'x/y');
    if (action === 'move') await adapter.move(displayId, point);
    else if (action === 'click') await adapter.click(displayId, point);
    else if (action === 'double_click') await adapter.doubleClick(displayId, point);
    else await adapter.rightClick(displayId, point);
    return baseResult(workspace, action, { ...point, ...(displayId ? { displayId } : {}), executed: true });
  }

  if (action === 'drag') {
    const from = await resolveDisplayPoint(adapter, displayId, args.x, args.y, 'x/y');
    const to = await resolveDisplayPoint(adapter, displayId, args.toX, args.toY, 'toX/toY');
    await adapter.drag(displayId, from, to);
    return baseResult(workspace, action, {
      x: from.x, y: from.y, toX: to.x, toY: to.y,
      ...(displayId ? { displayId } : {}), executed: true
    });
  }

  if (action === 'scroll') {
    const direction = String(args.direction || '').toLowerCase();
    if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error('scroll direction must be up, down, left, or right.');
    const distance = boundedInteger(args.distance, 1, 100000, DEFAULT_SCROLL_DISTANCE, 'distance');
    let point;
    if (args.x !== undefined || args.y !== undefined) {
      if (args.x === undefined || args.y === undefined) throw new Error('scroll requires both x and y when either coordinate is provided.');
      point = await resolveDisplayPoint(adapter, displayId, args.x, args.y, 'x/y');
    }
    await adapter.scroll(displayId, { direction, distance, point });
    return baseResult(workspace, action, { direction, distance, ...(point ? { x: point.x, y: point.y } : {}), ...(displayId ? { displayId } : {}), executed: true });
  }

  if (action === 'type') {
    const text = String(args.text ?? '');
    if (!text) throw new Error('type requires non-empty text.');
    const textBytes = Buffer.byteLength(text, 'utf8');
    if (textBytes > MAX_TYPE_TEXT_BYTES) throw new Error(`type text exceeds the ${MAX_TYPE_TEXT_BYTES}-byte limit.`);
    await adapter.typeText(text);
    return baseResult(workspace, action, { executed: true, textLength: text.length });
  }

  if (action === 'key') {
    const key = normalizeKey(args.key);
    await adapter.pressKey(key);
    return baseResult(workspace, action, { executed: true, key });
  }

  if (action === 'hotkey') {
    const chord = normalizeHotkey(args.keys);
    await adapter.pressKey(chord.keyName);
    return baseResult(workspace, action, { executed: true, key: chord.key, keys: chord.keys });
  }

  throw new Error(`Unsupported computer input action: ${action}.`);
}

async function resolveDisplayPoint(adapter, displayId, xValue, yValue, label) {
  const x = boundedInteger(xValue, 0, 100000, null, `${label} x`);
  const y = boundedInteger(yValue, 0, 100000, null, `${label} y`);
  const size = await adapter.size(displayId);
  if (x >= size.width || y >= size.height) {
    const target = displayId ? `display '${displayId}'` : 'the primary display';
    throw new Error(`${label} must be inside ${target} (${size.width}x${size.height}).`);
  }
  return { x, y };
}

function resolveAdapter(context) {
  return context?.computerAdapter || defaultComputerAdapter;
}

function optionalDisplayId(value) {
  const displayId = String(value ?? '').trim();
  return displayId || undefined;
}

function baseResult(workspace, action, extra = {}) {
  return { ok: true, workspace: workspace.alias, action, platform: process.platform, ...extra };
}

function normalizeKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) throw new Error('key requires a key name.');
  if (Object.hasOwn(MODIFIER_ALIASES, key)) throw new Error('Use hotkey for modifier chords.');
  return KEY_ALIASES[key] || key;
}

function normalizeHotkey(value) {
  if (!Array.isArray(value) || value.length < 2) throw new Error('hotkey requires at least one modifier and one key.');
  const raw = value.map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
  if (raw.length < 2) throw new Error('hotkey requires at least one modifier and one key.');
  const key = normalizeKey(raw.at(-1));
  const modifiers = raw.slice(0, -1).map(item => MODIFIER_ALIASES[item]);
  if (modifiers.some(item => !item)) throw new Error('hotkey modifiers must be ctrl/control, shift, alt/option, or cmd/command/meta/win/super.');
  return { key, keys: [...modifiers, key], keyName: [...modifiers, key].join('+') };
}

function boundedInteger(value, min, max, fallback, label) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw new Error(`${label} is required.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  const integer = Math.round(number);
  if (integer < min || integer > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return integer;
}

function queueInput(operation) {
  const run = inputQueue.then(operation, operation);
  inputQueue = run.catch(() => {});
  return run;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

export { computerControlSettings, readComputerStatus, runComputerAction };
