import type { ComputerControlResultDto, ComputerControlStatusDto } from './contracts/computer.ts';
import {
  assertComputerControlEnabled,
  computerControlSettings,
  type ComputerControlConfig
} from './computer/computerPolicy.ts';
import {
  createMidsceneComputerAdapter,
  type ComputerAdapter,
  type ComputerPoint,
  type ScrollDirection
} from './computer/midsceneAdapter.ts';

const COMPUTER_ACTIONS = new Set([
  'status', 'displays', 'screenshot', 'move', 'click', 'double_click', 'right_click',
  'drag', 'scroll', 'type', 'key', 'hotkey'
] as const);
const MODIFIER_ALIASES = Object.freeze({
  ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', option: 'alt',
  cmd: 'command', command: 'command', meta: 'command', win: 'command', super: 'command'
} as const);
const KEY_ALIASES = Object.freeze({
  return: 'enter', esc: 'escape', spacebar: 'space', del: 'delete',
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right'
} as const);
const DEFAULT_SCROLL_DISTANCE = 700;
const MAX_TYPE_TEXT_BYTES = 64 * 1024;
const defaultComputerAdapter = createMidsceneComputerAdapter();
let inputQueue: Promise<unknown> = Promise.resolve();

type ComputerAction = typeof COMPUTER_ACTIONS extends Set<infer T> ? T : never;

type ComputerWorkspace = Readonly<{ alias: string }>;
type ComputerArgs = Readonly<Record<string, unknown> & {
  action?: unknown;
  displayId?: unknown;
  x?: unknown;
  y?: unknown;
  toX?: unknown;
  toY?: unknown;
  direction?: unknown;
  distance?: unknown;
  text?: unknown;
  key?: unknown;
  keys?: unknown;
}>;
type ComputerContext = Readonly<{ computerAdapter?: ComputerAdapter }>;

async function readComputerStatus(
  config: ComputerControlConfig | null | undefined,
  context: ComputerContext = {}
): Promise<ComputerControlStatusDto> {
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

async function runComputerAction(
  workspace: ComputerWorkspace,
  config: ComputerControlConfig | null | undefined,
  args: ComputerArgs = {},
  context: ComputerContext = {}
): Promise<ComputerControlResultDto> {
  const action = normalizeAction(args.action);
  if (action === 'status') {
    return { ...(await readComputerStatus(config, context)), workspace: workspace.alias };
  }
  assertComputerControlEnabled(config);

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

async function executeInputAction(
  adapter: ComputerAdapter,
  workspace: ComputerWorkspace,
  action: ComputerAction,
  args: ComputerArgs
): Promise<ComputerControlResultDto> {
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
    const direction = normalizeScrollDirection(args.direction);
    const distance = boundedInteger(args.distance, 1, 100000, DEFAULT_SCROLL_DISTANCE, 'distance');
    let point: ComputerPoint | undefined;
    if (args.x !== undefined || args.y !== undefined) {
      if (args.x === undefined || args.y === undefined) throw new Error('scroll requires both x and y when either coordinate is provided.');
      point = await resolveDisplayPoint(adapter, displayId, args.x, args.y, 'x/y');
    }
    await adapter.scroll(displayId, { direction, distance, ...(point ? { point } : {}) });
    return baseResult(workspace, action, {
      direction,
      distance,
      ...(point ? { x: point.x, y: point.y } : {}),
      ...(displayId ? { displayId } : {}),
      executed: true
    });
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

async function resolveDisplayPoint(
  adapter: ComputerAdapter,
  displayId: string | undefined,
  xValue: unknown,
  yValue: unknown,
  label: string
): Promise<ComputerPoint> {
  const x = boundedInteger(xValue, 0, 100000, null, `${label} x`);
  const y = boundedInteger(yValue, 0, 100000, null, `${label} y`);
  const size = await adapter.size(displayId);
  if (x >= size.width || y >= size.height) {
    const target = displayId ? `display '${displayId}'` : 'the primary display';
    throw new Error(`${label} must be inside ${target} (${size.width}x${size.height}).`);
  }
  return { x, y };
}

function normalizeAction(value: unknown): ComputerAction {
  const action = String(value || '').trim().toLowerCase();
  if (!COMPUTER_ACTIONS.has(action as ComputerAction)) {
    throw new Error(`Unsupported computer action: ${action || '(missing)'}.`);
  }
  return action as ComputerAction;
}

function resolveAdapter(context: ComputerContext): ComputerAdapter {
  return context.computerAdapter || defaultComputerAdapter;
}

function optionalDisplayId(value: unknown): string | undefined {
  const displayId = String(value ?? '').trim();
  return displayId || undefined;
}

function baseResult(
  workspace: ComputerWorkspace,
  action: string,
  extra: Readonly<Record<string, unknown>> = {}
): ComputerControlResultDto {
  return { ok: true, workspace: workspace.alias, action, platform: process.platform, ...extra };
}

function normalizeKey(value: unknown): string {
  const key = String(value || '').trim().toLowerCase();
  if (!key) throw new Error('key requires a key name.');
  if (Object.hasOwn(MODIFIER_ALIASES, key)) throw new Error('Use hotkey for modifier chords.');
  return KEY_ALIASES[key as keyof typeof KEY_ALIASES] || key;
}

function normalizeHotkey(value: unknown): { key: string; keys: string[]; keyName: string } {
  if (!Array.isArray(value) || value.length < 2) throw new Error('hotkey requires at least one modifier and one key.');
  const raw = value.map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
  if (raw.length < 2) throw new Error('hotkey requires at least one modifier and one key.');
  const key = normalizeKey(raw.at(-1));
  const modifiers = raw.slice(0, -1).map(item => MODIFIER_ALIASES[item as keyof typeof MODIFIER_ALIASES]);
  if (modifiers.some(item => !item)) throw new Error('hotkey modifiers must be ctrl/control, shift, alt/option, or cmd/command/meta/win/super.');
  const keys = [...modifiers, key] as string[];
  return { key, keys, keyName: keys.join('+') };
}

function normalizeScrollDirection(value: unknown): ScrollDirection {
  const direction = String(value || '').toLowerCase();
  if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error('scroll direction must be up, down, left, or right.');
  return direction as ScrollDirection;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number | null,
  label: string
): number {
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

function queueInput<T>(operation: () => Promise<T>): Promise<T> {
  const run = inputQueue.then(operation, operation);
  inputQueue = run.catch(() => undefined);
  return run;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

export { computerControlSettings, readComputerStatus, runComputerAction };
