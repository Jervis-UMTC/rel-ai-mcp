import { upsertToastOverlay } from '../overlay-store.js';

const TOAST_VARIANTS = Object.freeze({
  info: { symbol: 'i', label: 'Information', role: 'status', duration: 5000 },
  success: { symbol: '✓', label: 'Success', role: 'status', duration: 4000 },
  warn: { symbol: '!', label: 'Warning', role: 'status', duration: 8000 },
  error: { symbol: '×', label: 'Error', role: 'alert', duration: 0 }
});

export function toast(message, { variant = 'info', duration } = {}) {
  const tone = Object.hasOwn(TOAST_VARIANTS, variant) ? variant : 'info';
  const metadata = TOAST_VARIANTS[tone];
  const text = String(message || '');
  const effectiveDuration = Number.isFinite(duration) ? Math.max(0, duration) : metadata.duration;
  return upsertToastOverlay({
    key: `${tone}\u0000${text}`,
    tone,
    symbol: metadata.symbol,
    text,
    role: metadata.role,
    ariaLabel: `${metadata.label}: ${text}`,
    dismissLabel: `Dismiss ${metadata.label.toLowerCase()} notification`,
    duration: effectiveDuration
  });
}
