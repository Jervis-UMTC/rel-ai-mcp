import { closeDrawerOverlay, openDrawerOverlay } from '../overlay-store.js';

let _drawerId = '';
let _drawerOnClose = null;

export function openDrawer({ title, content, onClose, panelClass = '' } = {}) {
  closeDrawer();
  _drawerOnClose = typeof onClose === 'function' ? onClose : null;
  const finish = () => finishClose();
  _drawerId = openDrawerOverlay({
    title: String(title || ''),
    content,
    panelClass: String(panelClass || ''),
    opener: document.activeElement,
    onDismiss: finish
  });
  return { close: finish };
}

function finishClose() {
  const onClose = _drawerOnClose;
  closeDrawer();
  onClose?.();
}

export function closeDrawer() {
  if (_drawerId && !closeDrawerOverlay(_drawerId)) closeDrawerOverlay();
  else if (!_drawerId) closeDrawerOverlay();
  _drawerId = '';
  _drawerOnClose = null;
}
