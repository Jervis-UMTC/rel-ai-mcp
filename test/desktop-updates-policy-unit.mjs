import assert from 'node:assert/strict';

import { supportPolicyView } from '../src/ui/features/settings/desktop-update-policy.js';
import { normalizeReleaseNoteText, updateView } from '../src/ui/features/settings/react.js';

assert.equal(supportPolicyView({ state: 'current', currentVersion: '0.25.0', minimumSupportedVersion: '0.25.0' }).label, 'Supported');
assert.equal(supportPolicyView({ state: 'required', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0' }).tone, 'bad');
assert.match(supportPolicyView({ state: 'required', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0' }).description, /v0\.25\.0/);
assert.match(supportPolicyView({ state: 'deprecated', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0', enforceAfter: '2026-09-01T00:00:00.000Z' }).description, /2026|September|Sep/);
assert.match(supportPolicyView({ state: 'unavailable' }).description, /keep using the app/i);

const available = updateView({ state: 'available', availableVersion: '0.25.3', currentVersion: '0.25.2' }, false);
assert.equal(available.label, 'Update available');
assert.equal(available.action.id, 'download');
assert.match(available.action.label, /0\.25\.3/);

const autoDownload = updateView({ state: 'available', availableVersion: '0.25.3' }, true);
assert.match(autoDownload.description, /download it automatically/i);

const downloaded = updateView({ state: 'downloaded', availableVersion: '0.25.3', installMode: 'open_dmg' }, false);
assert.equal(downloaded.action.id, 'install');
assert.equal(downloaded.action.label, 'DMG');

const htmlNote = normalizeReleaseNoteText('<h3>Linux desktop and update reliability</h3><ul><li><strong>Restore close-to-tray behavior</strong></li><li>Fix &amp; verify updates</li></ul>');
assert.match(htmlNote, /Linux desktop and update reliability/);
assert.match(htmlNote, /Restore close-to-tray behavior/);
assert.match(htmlNote, /Fix & verify updates/);
assert.doesNotMatch(htmlNote, /<\/?(?:h3|ul|li|strong)>/i, 'updater HTML must not be injected into the dashboard');

console.log('Desktop update support policy and React update-view tests passed.');
