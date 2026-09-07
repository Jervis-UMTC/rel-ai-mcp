import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

import { MAX_CLIPBOARD_TEXT_BYTES } from './ipc-security.js';

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function createDesktopOsOperations(options = {}) {
  const {
    shell,
    clipboard,
    platform = process.platform,
    spawn = nodeSpawn
  } = options;
  if (!shell || typeof shell.openPath !== 'function' || typeof shell.openExternal !== 'function' || typeof shell.showItemInFolder !== 'function') {
    throw new TypeError('Structured desktop operations require Electron shell APIs.');
  }
  if (!clipboard || typeof clipboard.readText !== 'function' || typeof clipboard.writeText !== 'function') {
    throw new TypeError('Structured desktop operations require Electron clipboard APIs.');
  }
  if (typeof spawn !== 'function') throw new TypeError('Structured desktop operations require a process spawn function.');

  async function run(payload = {}) {
    const action = String(payload.action || '').trim();
    switch (action) {
      case 'open_path': {
        const target = existingAbsolutePath(payload.path);
        const failure = await shell.openPath(target);
        if (String(failure || '').trim()) throw new Error(`Could not open desktop path: ${String(failure).trim()}`);
        return { ok: true, platform };
      }
      case 'reveal_path': {
        const target = existingAbsolutePath(payload.path);
        shell.showItemInFolder(target);
        return { ok: true, platform };
      }
      case 'open_uri': {
        const uri = normalizeExternalUri(payload.uri);
        await shell.openExternal(uri);
        return { ok: true, platform };
      }
      case 'launch_application': {
        const application = normalizeApplicationIdentifier(payload.application);
        await launchApplication(application, { platform, spawn });
        return { ok: true, platform };
      }
      case 'clipboard_read': {
        const text = String(clipboard.readText() || '');
        assertClipboardSize(text);
        return { ok: true, platform, text };
      }
      case 'clipboard_write': {
        if (typeof payload.text !== 'string') throw new Error('Clipboard text must be a string.');
        const text = payload.text.replaceAll('\u0000', '');
        assertClipboardSize(text);
        clipboard.writeText(text);
        return { ok: true, platform };
      }
      default:
        throw new Error(`Unsupported native desktop action: ${action || '(missing)'}.`);
    }
  }

  return Object.freeze({ run });
}

function existingAbsolutePath(value) {
  const target = String(value || '').trim();
  if (!target || !path.isAbsolute(target)) throw new Error('Native desktop path must be absolute.');
  if (!fs.existsSync(target)) throw new Error('Native desktop path does not exist.');
  const stat = fs.statSync(target);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('Native desktop path must be a file or directory.');
  return target;
}

function normalizeExternalUri(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Desktop URI is required.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Desktop URI must be an absolute valid URI.');
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
    throw new Error(`Desktop URI protocol is not allowed: ${parsed.protocol || '(missing)'}.`);
  }
  return parsed.href;
}

function normalizeApplicationIdentifier(value) {
  const application = String(value || '').trim();
  if (!application) throw new Error('Application identifier is required.');
  if (application.length > 200) throw new Error('Application identifier is too long.');
  if (application.startsWith('-') || /[\\/:]/.test(application) || hasControlCharacter(application)) {
    throw new Error('Application identifier must be a plain application name, executable name, or desktop identifier, not a path or command.');
  }
  return application;
}

function hasControlCharacter(value) {
  return [...value].some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function launchApplication(application, options = {}) {
  const platform = String(options.platform || process.platform);
  const spawn = options.spawn || nodeSpawn;
  if (platform === 'win32') {
    return waitForSpawn(spawn, application, [], {
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    }, application);
  }
  if (platform === 'darwin') {
    return waitForLauncher(spawn, '/usr/bin/open', ['-a', application], application);
  }
  if (platform === 'linux') {
    return waitForLauncher(spawn, 'gtk-launch', [application], application, {
      missingMessage: 'Linux application launch requires gtk-launch on this installation.'
    });
  }
  throw new Error(`Application launch is not supported on platform: ${platform}.`);
}

function waitForSpawn(spawn, executable, argv, options, application) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, argv, options);
    } catch (error) {
      reject(applicationLaunchError(application, error));
      return;
    }
    let settled = false;
    const finish = action => {
      if (settled) return;
      settled = true;
      child.off?.('error', onError);
      child.off?.('spawn', onSpawn);
      action();
    };
    const onError = error => finish(() => reject(applicationLaunchError(application, error)));
    const onSpawn = () => finish(() => {
      child.unref?.();
      resolve();
    });
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

function waitForLauncher(spawn, executable, argv, application, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, argv, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      reject(launcherError(application, error, options));
      return;
    }
    let stderr = '';
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on?.('data', chunk => {
      if (stderr.length < 8192) stderr += String(chunk || '').slice(0, 8192 - stderr.length);
    });
    child.once('error', error => reject(launcherError(application, error, options)));
    child.once('close', code => {
      if (Number(code || 0) === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(new Error(`Application '${application}' could not be launched${detail ? `: ${detail}` : '.'}`));
    });
  });
}

function launcherError(application, error, options = {}) {
  if (error?.code === 'ENOENT' && options.missingMessage) return new Error(options.missingMessage);
  return applicationLaunchError(application, error);
}

function applicationLaunchError(application, error) {
  const detail = error instanceof Error ? error.message : String(error || 'Unknown launch error');
  return new Error(`Application '${application}' could not be launched: ${detail}`);
}

function assertClipboardSize(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_TEXT_BYTES) {
    throw new Error('Clipboard text exceeds the 64 KiB safety limit.');
  }
}

export {
  ALLOWED_EXTERNAL_PROTOCOLS,
  createDesktopOsOperations,
  launchApplication,
  normalizeApplicationIdentifier,
  normalizeExternalUri
};
