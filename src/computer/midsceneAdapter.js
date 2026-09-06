const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const PRIMARY_DISPLAY_KEY = '__primary__';

function createMidsceneComputerAdapter(options = {}) {
  const importMidscene = options.importMidscene || (() => import('@midscene/computer'));
  let modulePromise = null;
  const devicePromises = new Map();

  async function runtime() {
    if (!modulePromise) {
      modulePromise = Promise.resolve().then(importMidscene).catch(error => {
        modulePromise = null;
        throw error;
      });
    }
    return modulePromise;
  }

  async function environment() {
    const midscene = await runtime();
    return midscene.checkComputerEnvironment();
  }

  async function listDisplays() {
    const { ComputerDevice } = await runtime();
    const displays = await ComputerDevice.listDisplays();
    return (Array.isArray(displays) ? displays : []).map(display => ({
      id: String(display.id),
      name: String(display.name || display.id),
      primary: display.primary === true,
      coordinateSpace: 'display-local-pixels'
    }));
  }

  async function device(displayId) {
    const normalizedId = normalizeDisplayId(displayId);
    const key = normalizedId || PRIMARY_DISPLAY_KEY;
    let pending = devicePromises.get(key);
    if (!pending) {
      pending = createDevice(normalizedId);
      devicePromises.set(key, pending);
      pending.catch(() => devicePromises.delete(key));
    }
    return pending;
  }

  async function createDevice(displayId) {
    const { ComputerDevice } = await runtime();
    const instance = new ComputerDevice(displayId ? { displayId } : undefined);
    try {
      await instance.connect();
      return instance;
    } catch (error) {
      try { await instance.destroy(); } catch {}
      throw error;
    }
  }

  async function size(displayId) {
    const instance = await device(displayId);
    const value = await instance.size();
    return {
      width: positiveInteger(value?.width, 'screen width'),
      height: positiveInteger(value?.height, 'screen height')
    };
  }

  async function screenshot(displayId) {
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

  async function move(displayId, point) {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.hover(point);
  }

  async function click(displayId, point) {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.tap(point);
  }

  async function doubleClick(displayId, point) {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.doubleClick(point);
  }

  async function rightClick(displayId, point) {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.rightClick(point);
  }

  async function drag(displayId, from, to) {
    const instance = await device(displayId);
    await instance.inputPrimitives.pointer.dragAndDrop(from, to);
  }

  async function scroll(displayId, param) {
    const instance = await device(displayId);
    await instance.inputPrimitives.scroll.scroll({
      scrollType: 'singleAction',
      direction: param.direction,
      distance: param.distance,
      ...(param.point ? { locate: { center: [param.point.x, param.point.y] } } : {})
    });
  }

  async function typeText(text) {
    const instance = await device();
    await instance.inputPrimitives.keyboard.typeText(text, { replace: false });
  }

  async function pressKey(keyName) {
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

function normalizeDisplayId(value) {
  const id = String(value ?? '').trim();
  return id || undefined;
}

function decodeScreenshot(value) {
  const encoded = String(value || '').trim();
  if (!encoded) throw new Error('Midscene returned an empty screenshot.');
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(encoded);
  const mimeType = match?.[1] || 'image/png';
  const data = match?.[2] || encoded;
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) throw new Error('Midscene returned invalid screenshot data.');
  return { mimeType, buffer };
}

function positiveInteger(value, label) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Midscene returned an invalid ${label}.`);
  return number;
}

export { createMidsceneComputerAdapter };
