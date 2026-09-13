import assert from 'node:assert/strict';

const { toast } = await import(new URL('../src/ui/components/toast.js', import.meta.url));
const {
  getOverlaySnapshot,
  removeToastOverlay,
  subscribeOverlay
} = await import(new URL('../src/ui/overlay-store.js', import.meta.url));

let notifications = 0;
const unsubscribe = subscribeOverlay(() => { notifications += 1; });

try {
  const first = toast('Saved', { variant: 'success', duration: 100 });
  let snapshot = getOverlaySnapshot();
  assert.equal(snapshot.toasts.length, 1, 'a toast must publish one canonical overlay descriptor');
  assert.equal(snapshot.toasts[0].id, first);
  assert.equal(snapshot.toasts[0].tone, 'success');
  assert.equal(snapshot.toasts[0].role, 'status');
  assert.equal(snapshot.toasts[0].ariaLabel, 'Success: Saved');
  assert.equal(snapshot.toasts[0].dismissLabel, 'Dismiss success notification');
  assert.equal(snapshot.toasts[0].duration, 100);
  assert.equal(snapshot.toasts[0].revision, 0);

  const second = toast('Saved', { variant: 'success', duration: 100 });
  snapshot = getOverlaySnapshot();
  assert.equal(second, first, 'identical active notifications should be coalesced');
  assert.equal(snapshot.toasts.length, 1, 'coalescing must not add another overlay descriptor');
  assert.equal(snapshot.toasts[0].revision, 1, 'coalescing must refresh the existing toast descriptor');

  const persistent = toast('Connection failed', { variant: 'error' });
  snapshot = getOverlaySnapshot();
  const persistentDescriptor = snapshot.toasts.find(item => item.id === persistent);
  assert.ok(persistentDescriptor, 'persistent errors must be present in overlay state');
  assert.equal(persistentDescriptor.role, 'alert');
  assert.equal(persistentDescriptor.duration, 0, 'error notifications must remain until dismissed by default');

  const duplicateError = toast('Connection failed', { variant: 'error' });
  snapshot = getOverlaySnapshot();
  assert.equal(duplicateError, persistent, 'repeated persistent errors should not stack');
  assert.equal(snapshot.toasts.filter(item => item.id === persistent).length, 1);

  assert.equal(removeToastOverlay(persistent), true, 'manual dismissal must remove a persistent error');
  assert.equal(getOverlaySnapshot().toasts.some(item => item.id === persistent), false);
  assert.equal(removeToastOverlay(persistent), false, 'dismissing an already removed toast must be a no-op');

  const afterDismiss = toast('Connection failed', { variant: 'error' });
  assert.notEqual(afterDismiss, persistent, 'a dismissed notification may be shown again later');
  assert.ok(notifications >= 6, 'toast mutations must notify overlay subscribers');

  console.log('Toast overlay behavior passed.');
} finally {
  unsubscribe();
}
