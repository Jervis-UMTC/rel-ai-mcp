let sequence = 0;
let snapshot = Object.freeze({ drawer: null, modal: null, toasts: [] });
const listeners = new Set();

export function getOverlaySnapshot() {
  return snapshot;
}

export function subscribeOverlay(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openModalOverlay(descriptor = {}) {
  const id = `modal-${++sequence}`;
  commit({ modal: Object.freeze({ ...descriptor, id }) });
  return id;
}

export function updateModalOverlay(id, patch = {}) {
  if (!id || snapshot.modal?.id !== id) return false;
  commit({ modal: Object.freeze({ ...snapshot.modal, ...patch }) });
  return true;
}

export function closeModalOverlay(id = '') {
  if (id && snapshot.modal?.id !== id) return false;
  if (!snapshot.modal) return false;
  commit({ modal: null });
  return true;
}

export function openDrawerOverlay(descriptor = {}) {
  const id = `drawer-${++sequence}`;
  commit({ drawer: Object.freeze({ ...descriptor, id }) });
  return id;
}

export function updateDrawerOverlay(id, patch = {}) {
  if (!id || snapshot.drawer?.id !== id) return false;
  commit({ drawer: Object.freeze({ ...snapshot.drawer, ...patch }) });
  return true;
}

export function closeDrawerOverlay(id = '') {
  if (id && snapshot.drawer?.id !== id) return false;
  if (!snapshot.drawer) return false;
  commit({ drawer: null });
  return true;
}

export function upsertToastOverlay(descriptor = {}) {
  const key = String(descriptor.key || '');
  const existing = key ? snapshot.toasts.find(item => item.key === key) : null;
  if (existing) {
    const next = snapshot.toasts.map(item => item.id === existing.id
      ? Object.freeze({ ...item, ...descriptor, id: item.id, revision: Number(item.revision || 0) + 1 })
      : item);
    commit({ toasts: next });
    return existing.id;
  }
  const id = `toast-${++sequence}`;
  commit({ toasts: [...snapshot.toasts, Object.freeze({ ...descriptor, id, revision: 0 })] });
  return id;
}

export function removeToastOverlay(id) {
  const next = snapshot.toasts.filter(item => item.id !== id);
  if (next.length === snapshot.toasts.length) return false;
  commit({ toasts: next });
  return true;
}

function commit(patch) {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  for (const listener of [...listeners]) listener();
}
