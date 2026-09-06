const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const PRIMARY_DISPLAY_KEY = '__primary__';

type ComputerPoint = Readonly<{ x: number; y: number }>;
type ScrollDirection = 'up' | 'down' | 'left' | 'right';

type ComputerDisplay = Readonly<{
  id: string;
  name: string;
  primary: boolean;
  coordinateSpace: 'display-local-pixels';
}>;

type ComputerImage = Readonly<{
  mimeType: string;
  data: string;
  bytes: number;
  width: number;
  height: number;
}>;

type ComputerEnvironment = Readonly<{
  available?: boolean;
  platform?: string;
  displays?: number;
  error?: string;
}>;

interface MidsceneDevice {
  connect(): Promise<void>;
  destroy(): Promise<void>;
  size(): Promise<{ width?: unknown; height?: unknown }>;
  screenshotBase64(): Promise<string>;
  readonly inputPrimitives: {
    readonly pointer: {
      hover(point: ComputerPoint): Promise<void>;
      tap(point: ComputerPoint): Promise<void>;
      doubleClick(point: ComputerPoint): Promise<void>;
      rightClick(point: ComputerPoint): Promise<void>;
      dragAndDrop(from: ComputerPoint, to: ComputerPoint): Promise<void>;
    };
    readonly scroll: {
      scroll(value: Readonly<{
        scrollType: 'singleAction';
        direction: ScrollDirection;
        distance: number;
        locate?: Readonly<{ center: readonly [number, number] }>;
      }>): Promise<void>;
    };
    readonly keyboard: {
      typeText(text: string, options: Readonly<{ replace: false }>): Promise<void>;
      keyboardPress(keyName: string): Promise<void>;
    };
  };
}

interface MidsceneDeviceConstructor {
  new(options?: Readonly<{ displayId: string }>): MidsceneDevice;
  listDisplays(): Promise<readonly Readonly<{ id: unknown; name?: unknown; primary?: unknown }>[] | unknown>;
}

interface MidsceneModule {
  readonly ComputerDevice: MidsceneDeviceConstructor;
  checkComputerEnvironment(): Promise<ComputerEnvironment>;
}

interface MidsceneAdapterOptions {
  readonly importMidscene?: () => Promise<unknown>;
}

interface ComputerAdapter {
  readonly engine?: string;
  environment(): Promise<ComputerEnvironment>;
  listDisplays(): Promise<ComputerDisplay[]>;
  size(displayId?: string): Promise<{ width: number; height: number }>;
  screenshot(displayId?: string): Promise<ComputerImage>;
  move(displayId: string | undefined, point: ComputerPoint): Promise<void>;
  click(displayId: string | undefined, point: ComputerPoint): Promise<void>;
  doubleClick(displayId: string | undefined, point: ComputerPoint): Promise<void>;
  rightClick(displayId: string | undefined, point: ComputerPoint): Promise<void>;
  drag(displayId: string | undefined, from: ComputerPoint, to: ComputerPoint): Promise<void>;
  scroll(displayId: string | undefined, param: Readonly<{
    direction: ScrollDirection;
    distance: number;
    point?: ComputerPoint;
  }>): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(keyName: string): Promise<void>;
}

function createMidsceneComputerAdapter(options: MidsceneAdapterOptions = {}): ComputerAdapter {
  const importMidscene = options.importMidscene || (() => import('@midscene/computer'));
  let modulePromise: Promise<MidsceneModule> | null = null;
  const devicePromises = new Map<string, Promise<MidsceneDevice>>();

  async function runtime(): Promise<MidsceneModule> {
    if (!modulePromise) {
      modulePromise = Promise.resolve()
        .then(importMidscene)
        .then(normalizeMidsceneModule)
        .catch((error: unknown) => {
          modulePromise = null;
          throw error;
        });
    }
    return modulePromise;
  }

  async function environment(): Promise<ComputerEnvironment> {
    const midscene = await runtime();
    return midscene.checkComputerEnvironment();
  }

  async function listDisplays(): Promise<ComputerDisplay[]> {
    const { ComputerDevice } = await runtime();
    const displays = await ComputerDevice.listDisplays();
    return (Array.isArray(displays) ? displays : []).map(display => ({
      id: String(display.id),
      name: String(display.name || display.id),
      primary: display.primary === true,
      coordinateSpace: 'display-local-pixels' as const
    }));
  }

  async function device(displayId?: string): Promise<MidsceneDevice> {
    const normalizedId = normalizeDisplayId(displayId);
    const key = normalizedId || PRIMARY_DISPLAY_KEY;
    let pending = devicePromises.get(key);
    if (!pending) {
      pending = createDevice(normalizedId);
      devicePromises.set(key, pending);
      void pending.catch(() => devicePromises.delete(key));
    }
    return pending;
  }

  async function createDevice(displayId?: string): Promise<MidsceneDevice> {
    const { ComputerDevice } = await runtime();
    const instance = displayId ? new ComputerDevice({ displayId }) : new ComputerDevice();
    try {
      await instance.connect();
      return instance;
    } catch (error) {
      try { await instance.destroy(); } catch {}
      throw error;
    }
  }

  async function size(displayId?: string): Promise<{ width: number; height: number }> {
    const instance = await device(displayId);
    const value = await instance.size();
    return {
      width: positiveInteger(value?.width, 'screen width'),
      height: positiveInteger(value?.height, 'screen height')
    };
  }

  async function screenshot(displayId?: string): Promise<ComputerImage> {
    const instance = await device(displayId);
    const [encoded, dimensions] = await Promise.all([
      instance.screenshotBase64(),
      instance.size()
    ]);
    const image = decodeScreenshot(encoded);
    if (image.buffer.length > MAX_SCREENSHOT_BYTES) {
      throw new Error(`Computer screenshot exceeds the ${MAX_SCREENSHOT_BYTES}-byte image limit.`);
    }
    return {
      mimeType: image.mimeType,
      data: image.buffer.toString('base64'),
      bytes: image.buffer.length,
      width: positiveInteger(dimensions?.width, 'screenshot width'),
      height: positiveInteger(dimensions?.height, 'screenshot height')
    };
  }

  async function move(displayId: string | undefined, point: ComputerPoint): Promise<void> {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.hover(point);
  }

  async function click(displayId: string | undefined, point: ComputerPoint): Promise<void> {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.tap(point);
  }

  async function doubleClick(displayId: string | undefined, point: ComputerPoint): Promise<void> {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.doubleClick(point);
  }

  async function rightClick(displayId: string | undefined, point: ComputerPoint): Promise<void> {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.rightClick(point);
  }

  async function drag(displayId: string | undefined, from: ComputerPoint, to: ComputerPoint): Promise<void> {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.dragAndDrop(from, to);
  }

  async function scroll(
    displayId: string | undefined,
    param: Readonly<{ direction: ScrollDirection; distance: number; point?: ComputerPoint }>
  ): Promise<void> {
    const instance = await device(displayId);
    await instance.inputPrimitives.scroll.scroll({
      scrollType: 'singleAction',
      direction: param.direction,
      distance: param.distance,
      ...(param.point ? { locate: { center: [param.point.x, param.point.y] as const } } : {})
    });
  }

  async function typeText(text: string): Promise<void> {
    const instance = await device();
    await instance.inputPrimitives.keyboard.typeText(text, { replace: false });
  }

  async function pressKey(keyName: string): Promise<void> {
    const instance = await device();
    await instance.inputPrimitives.keyboard.keyboardPress(keyName);
  }

  return Object.freeze({
    engine: '@midscene/computer',
    environment,
    listDisplays,
    size,
    screenshot,
    move,
    click,
    doubleClick,
    rightClick,
    drag,
    scroll,
    typeText,
    pressKey
  });
}

function normalizeMidsceneModule(value: unknown): MidsceneModule {
  if (!value || typeof value !== 'object') throw new Error('@midscene/computer did not expose the expected runtime.');
  const candidate = value as Partial<MidsceneModule>;
  if (typeof candidate.ComputerDevice !== 'function' || typeof candidate.checkComputerEnvironment !== 'function') {
    throw new Error('@midscene/computer did not expose the expected ComputerDevice runtime.');
  }
  return candidate as MidsceneModule;
}

function normalizeDisplayId(value: unknown): string | undefined {
  const id = String(value ?? '').trim();
  return id || undefined;
}

function decodeScreenshot(value: unknown): { mimeType: string; buffer: Buffer } {
  const encoded = String(value || '').trim();
  if (!encoded) throw new Error('Midscene returned an empty screenshot.');
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(encoded);
  const mimeType = match?.[1] || 'image/png';
  const data = match?.[2] || encoded;
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) throw new Error('Midscene returned invalid screenshot data.');
  return { mimeType, buffer };
}

function positiveInteger(value: unknown, label: string): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Midscene returned an invalid ${label}.`);
  return number;
}

export { createMidsceneComputerAdapter };
export type {
  ComputerAdapter,
  ComputerPoint,
  ScrollDirection
};
