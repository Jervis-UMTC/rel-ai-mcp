import assert from 'node:assert/strict';

import {
  PROCESS_LIFECYCLE_STATUSES,
  TUNNEL_LIFECYCLE_STATUSES,
  UPDATER_LIFECYCLE_STATUSES,
  assertConnectionLayerTransition,
  assertProcessStatusTransition,
  assertTunnelLifecycleTransition,
  assertUpdaterLifecycleTransition,
  canTransitionConnectionLayer,
  canTransitionProcessStatus,
  canTransitionTunnelLifecycle,
  canTransitionUpdaterLifecycle,
  normalizeProcessLifecycleStatus,
  normalizeTunnelLifecycleStatus,
  normalizeUpdaterLifecycleStatus
} from '../src/runtimeLifecycle.js';
import {
  NATIVE_TASK_TRANSITIONS,
  canTransitionNativeTaskStatus,
  normalizeNativeTaskStatus
} from '../src/taskState.js';

assert.deepEqual(PROCESS_LIFECYCLE_STATUSES, ['starting', 'running', 'stopping', 'orphaned', 'stopped', 'exited', 'failed']);
assert.equal(normalizeProcessLifecycleStatus('RUNNING'), 'running');
assert.equal(normalizeProcessLifecycleStatus('unknown'), '');
assert.equal(canTransitionProcessStatus('starting', 'running'), true);
assert.equal(canTransitionProcessStatus('running', 'stopping'), true);
assert.equal(canTransitionProcessStatus('stopping', 'stopped'), true);
assert.equal(canTransitionProcessStatus('stopped', 'running'), false);
assert.equal(assertProcessStatusTransition('running', 'stopping'), 'stopping');
assert.throws(() => assertProcessStatusTransition('stopped', 'running'), error => error?.code === 'INVALID_PROCESS_STATE');

assert.deepEqual(TUNNEL_LIFECYCLE_STATUSES, ['stopped', 'starting', 'locally_ready', 'authenticating', 'running', 'degraded', 'failed']);
assert.equal(normalizeTunnelLifecycleStatus('locally_ready'), 'locally_ready');
assert.equal(canTransitionTunnelLifecycle('stopped', 'starting'), true);
assert.equal(canTransitionTunnelLifecycle('starting', 'locally_ready'), true);
assert.equal(canTransitionTunnelLifecycle('locally_ready', 'authenticating'), true);
assert.equal(canTransitionTunnelLifecycle('authenticating', 'running'), true);
assert.equal(canTransitionTunnelLifecycle('running', 'degraded'), true);
assert.equal(canTransitionTunnelLifecycle('degraded', 'running'), true);
assert.equal(canTransitionTunnelLifecycle('failed', 'running'), false);
assert.equal(assertTunnelLifecycleTransition('degraded', 'failed'), 'failed');
assert.throws(() => assertTunnelLifecycleTransition('stopped', 'running'), error => error?.code === 'INVALID_TUNNEL_STATE');

assert.deepEqual(UPDATER_LIFECYCLE_STATUSES, ['unsupported', 'idle', 'checking', 'up_to_date', 'available', 'downloading', 'downloaded', 'installing', 'error']);
assert.equal(normalizeUpdaterLifecycleStatus('DOWNLOADING'), 'downloading');
assert.equal(normalizeUpdaterLifecycleStatus('mystery'), '');
assert.equal(canTransitionUpdaterLifecycle('idle', 'checking'), true);
assert.equal(canTransitionUpdaterLifecycle('checking', 'available'), true);
assert.equal(canTransitionUpdaterLifecycle('available', 'downloading'), true);
assert.equal(canTransitionUpdaterLifecycle('downloading', 'downloaded'), true);
assert.equal(canTransitionUpdaterLifecycle('downloaded', 'installing'), true);
assert.equal(canTransitionUpdaterLifecycle('unsupported', 'checking'), false);
assert.equal(assertUpdaterLifecycleTransition('error', 'checking'), 'checking');
assert.throws(() => assertUpdaterLifecycleTransition('unsupported', 'checking'), error => error?.code === 'INVALID_UPDATER_STATE');

assert.equal(canTransitionConnectionLayer('localService', 'stopped', 'starting'), true);
assert.equal(canTransitionConnectionLayer('localService', 'starting', 'running'), true);
assert.equal(canTransitionConnectionLayer('publicEndpoint', 'connecting', 'available'), true);
assert.equal(canTransitionConnectionLayer('publicEndpoint', 'available', 'degraded'), true);
assert.equal(canTransitionConnectionLayer('chatgptReadiness', 'unavailable', 'ready'), true);
assert.equal(canTransitionConnectionLayer('dashboardUpdates', 'live', 'reconnecting'), true);
assert.equal(canTransitionConnectionLayer('localService', 'stopped', 'running'), false);
assert.equal(assertConnectionLayerTransition('publicEndpoint', 'degraded', 'available'), 'available');
assert.throws(() => assertConnectionLayerTransition('localService', 'stopped', 'running'), error => error?.code === 'INVALID_CONNECTION_STATE');

assert.ok(Object.isFrozen(NATIVE_TASK_TRANSITIONS));
assert.equal(normalizeNativeTaskStatus('INPUT_REQUIRED'), 'input_required');
assert.equal(normalizeNativeTaskStatus('running'), '');
assert.equal(canTransitionNativeTaskStatus('working', 'input_required'), true);
assert.equal(canTransitionNativeTaskStatus('input_required', 'working'), true);
assert.equal(canTransitionNativeTaskStatus('working', 'completed'), true);
assert.equal(canTransitionNativeTaskStatus('completed', 'working'), false);

console.log('Runtime lifecycle vocabularies and transition guards passed.');
