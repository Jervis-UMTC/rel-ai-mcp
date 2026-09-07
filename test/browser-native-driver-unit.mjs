import assert from 'node:assert/strict';

import {
  configureBrowserNativeBridge,
  dispatchBrowserNativeEvent,
  launchBrowserDriver
} from '../src/browser/browserDriver.ts';

const calls = [];
const bridge = async payload => {
  calls.push(payload);
  switch (payload.action) {
    case 'start':
      return { nativeSessionId: 'embedded_browser_abcdefghijklmnop', browserProduct: 'Embedded Test Chromium' };
    case 'open_page':
      return { nativePageId: 'embedded_page_abcdefghijklmnop' };
    case 'describe':
      return { url: 'https://example.test/', title: 'Example' };
    case 'navigate':
      return { url: payload.url, title: 'Navigated' };
    case 'close_page':
    case 'close_session':
      return { ok: true };
    default:
      return { url: 'https://example.test/' };
  }
};

configureBrowserNativeBridge(bridge);
try {
  const driver = await launchBrowserDriver({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    profileDirectory: 'C:/profiles/test'
  });
  assert.equal(driver.browserProduct, 'Embedded Test Chromium');
  assert.deepEqual(calls[0], {
    action: 'start',
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    profileDirectory: 'C:/profiles/test'
  });

  const page = await driver.createPage();
  assert.equal((await page.describe()).url, 'https://example.test/');
  assert.equal((await page.navigate('https://example.test/next', 5000)).url, 'https://example.test/next');

  let crashed = 0;
  page.onCrashed(() => { crashed += 1; });
  dispatchBrowserNativeEvent({
    resource: 'browser',
    type: 'page_crashed',
    nativeSessionId: 'embedded_browser_abcdefghijklmnop',
    nativePageId: 'embedded_page_abcdefghijklmnop'
  });
  assert.equal(crashed, 1, 'native page crashes must invalidate the service-side page proxy');

  let disconnected = 0;
  driver.onDisconnected(() => { disconnected += 1; });
  dispatchBrowserNativeEvent({
    resource: 'browser',
    type: 'session_disconnected',
    nativeSessionId: 'embedded_browser_abcdefghijklmnop'
  });
  assert.equal(disconnected, 1, 'native session disconnects must invalidate the service-side browser proxy');

  await driver.close();
  assert.ok(calls.some(call => call.action === 'close_session'), 'closing the proxy must close the native session');
} finally {
  configureBrowserNativeBridge(null);
}

console.log('Embedded browser native driver bridge and lifecycle events passed.');
