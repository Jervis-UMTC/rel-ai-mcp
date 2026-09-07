import fs from 'node:fs';
import http from 'node:http';
import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { createBrowserSurfaceHost } from '../../../electron/browser-surface-host.js';

const outputPath = process.env.RELAI_PROBE_OUTPUT_PATH;
if (!outputPath) throw new Error('Embedded browser probe output path is required.');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>Embedded fixture</title></head><body><main><h1>Embedded browser fixture</h1><label for="name">Name</label><input id="name" placeholder="Your name"><button id="save" type="button">Save</button></main></body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const targetUrl = `http://127.0.0.1:${address.port}/fixture`;
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  await win.loadURL('data:text/html,<html><body><div>Rel.AI dashboard probe</div></body></html>');

  const events = [];
  const states = [];
  const host = createBrowserSurfaceHost({
    WebContentsView,
    session,
    getDashboardWindow: () => win,
    openDashboard: async route => {
      if (route !== '#browser') throw new Error(`Unexpected dashboard route ${route}.`);
      win.show();
      win.focus();
    },
    onEvent: event => events.push(event),
    onStateChange: state => states.push(state)
  });

  try {
    const started = await host.run({ action: 'start' });
    const opened = await host.run({ action: 'open_page', nativeSessionId: started.nativeSessionId });
    const secondTab = await host.run({ action: 'open_page', nativeSessionId: started.nativeSessionId });
    const positioned = host.setBounds({ visible: true, x: 24, y: 80, width: 720, height: 480 });
    const tabState = host.selectTab(opened.nativePageId);
    const navigated = await host.run({
      action: 'navigate',
      nativeSessionId: started.nativeSessionId,
      nativePageId: opened.nativePageId,
      url: targetUrl,
      timeoutMs: 10_000
    });
    const snapshot = await host.run({
      action: 'snapshot',
      nativeSessionId: started.nativeSessionId,
      nativePageId: opened.nativePageId,
      timeoutMs: 10_000
    });
    await host.run({
      action: 'interact',
      nativeSessionId: started.nativeSessionId,
      nativePageId: opened.nativePageId,
      interaction: 'fill',
      target: { by: 'label', value: 'Name', exact: true },
      input: 'Rel.AI embedded'
    });
    const afterFill = await host.run({
      action: 'snapshot',
      nativeSessionId: started.nativeSessionId,
      nativePageId: opened.nativePageId,
      timeoutMs: 10_000
    });
    const screenshot = await host.run({
      action: 'screenshot',
      nativeSessionId: started.nativeSessionId,
      nativePageId: opened.nativePageId,
      fullPage: false
    });
    const afterTabClose = await host.closeTab(secondTab.nativePageId);
    const userState = host.setControl('user');
    let takeoverError = null;
    try {
      await host.run({
        action: 'navigate',
        nativeSessionId: started.nativeSessionId,
        nativePageId: opened.nativePageId,
        url: targetUrl
      });
    } catch (error) {
      takeoverError = { code: error?.code || '', message: error?.message || String(error) };
    }
    const aiState = host.setControl('ai');
    const finalState = host.getState();
    fs.writeFileSync(outputPath, JSON.stringify({
      started,
      positioned,
      tabState,
      afterTabClose,
      navigated,
      snapshot: snapshot.snapshot,
      afterFill: afterFill.snapshot,
      screenshotBytes: screenshot.image.bytes,
      screenshotWidth: screenshot.image.width,
      screenshotHeight: screenshot.image.height,
      userState,
      takeoverError,
      aiState,
      finalState,
      stateCount: states.length,
      events
    }, null, 2));
  } catch (error) {
    fs.writeFileSync(outputPath, JSON.stringify({ error: error?.stack || String(error), states, events }, null, 2));
    process.exitCode = 1;
  } finally {
    await host.closeAll().catch(() => {});
    if (!win.isDestroyed()) win.destroy();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    app.exit(process.exitCode || 0);
  }
}).catch(error => {
  fs.writeFileSync(outputPath, JSON.stringify({ error: error?.stack || String(error) }, null, 2));
  app.exit(1);
});
