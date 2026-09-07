import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { availableUpdateModalView, installingUpdateModalView, supportPolicyModalView } from '../src/ui/update-available-modal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src', 'ui', 'update-available-modal.js'), 'utf8');

const recommendedPolicy = { state: 'recommended', currentVersion: '0.25.0', minimumRecommendedVersion: '0.26.0', minimumSupportedVersion: '0.25.0', canContinue: true };
const deprecatedPolicy = { state: 'deprecated', currentVersion: '0.24.9', minimumRecommendedVersion: '0.25.0', minimumSupportedVersion: '0.25.0', enforceAfter: '2026-09-01T00:00:00.000Z', canContinue: true };
const requiredPolicy = { ...deprecatedPolicy, state: 'required', canContinue: false, requiresUpdate: true };
const emergencyPolicy = { ...requiredPolicy, state: 'emergency_blocked' };

assert.equal(supportPolicyModalView({ state: 'current' }), null);
assert.equal(supportPolicyModalView({ state: 'unavailable' }), null);
assert.equal(supportPolicyModalView(recommendedPolicy), null, 'recommended updates should stay passive instead of opening a modal');
assert.equal(supportPolicyModalView(deprecatedPolicy).allowLater, true);
assert.match(supportPolicyModalView(deprecatedPolicy).description, /September|2026|before/i);
assert.equal(supportPolicyModalView(requiredPolicy).blocking, true);
assert.equal(supportPolicyModalView(requiredPolicy).allowLater, false);
assert.match(supportPolicyModalView(emergencyPolicy).title, /critical/i);

assert.equal(availableUpdateModalView({ state: 'idle', availableVersion: '0.27.5' }), null);
assert.equal(availableUpdateModalView({ state: 'available' }), null);
const available = availableUpdateModalView({ state: 'available', availableVersion: '0.27.5' });
assert.equal(available.title, 'Update available');
assert.equal(available.allowLater, true);
assert.equal(available.blocking, false);
assert.match(available.description, /v0\.27\.5/);
assert.match(available.detail, /later launch/i);
const installing = installingUpdateModalView({ state: 'installing', availableVersion: '0.27.5' });
assert.equal(installing.blocking, true);
assert.equal(installing.allowLater, false);
assert.match(installing.title, /Updating Rel\.AI/i);
assert.match(installing.detail, /temporarily paused/i);

assert.doesNotMatch(source, /Ignore this version/, 'routine updates must not add permanent per-version ignore state');
assert.doesNotMatch(source, /getNotificationPreferences|setNotificationPreferences/, 'update modals must not depend on notification preferences');
assert.match(source, /supportPolicyModalView/, 'required and support-policy update notices must remain available');
assert.match(source, /shownUpdateKeys\.has\(updateView\.key\)/, 'routine update notices must deduplicate the offered version for the current launch');
assert.match(source, /shownPolicyKeys[\s\S]*availableUpdateModalView/, 'support-policy notices must retain priority over routine optional update notices');
const actionsStart = source.indexOf("h('div', { className: 'modal-actions' }");
const laterAction = source.indexOf("'Later'", actionsStart);
const primaryAction = source.indexOf('\n      primary', actionsStart);
assert.ok(actionsStart >= 0 && laterAction > actionsStart && primaryAction > laterAction, 'Later must remain before the primary update action');
assert.match(source, /keepModalOpen = method === 'installUpdate'/, 'installing must keep the blocking update modal visible while preparation runs');
assert.match(source, /role: 'status'[\s\S]*'aria-live': 'polite'[\s\S]*'aria-busy': 'true'/, 'install progress must be announced accessibly');
assert.match(source, /install-failed:/, 'failed update preparation must keep a retryable in-app recovery modal');

console.log('Update available and support-policy modal interaction tests passed.');
