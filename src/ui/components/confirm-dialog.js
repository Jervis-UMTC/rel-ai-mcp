import { hasOpenModal, openModal, showModalConfirmation } from './modal.js';

export function confirmAction({
  title = 'Confirm action',
  message = 'Continue with this action?',
  detail = '',
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger = false
} = {}) {
  const options = { title, message, detail, confirmLabel, cancelLabel, danger };
  if (hasOpenModal()) return showModalConfirmation(options);

  return new Promise(resolve => {
    let settled = false;
    let modal = null;
    const settle = value => {
      if (settled) return;
      settled = true;
      modal?.close();
      resolve(value);
    };
    modal = openModal({
      title,
      content: {
        kind: 'confirm-dialog',
        message: String(message || ''),
        detail: String(detail || ''),
        confirmLabel: String(confirmLabel || 'Continue'),
        cancelLabel: String(cancelLabel || 'Cancel'),
        danger: danger === true,
        onCancel: () => { void modal?.dismiss(); },
        onConfirm: () => settle(true)
      },
      size: 'compact',
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }
    });
  });
}
