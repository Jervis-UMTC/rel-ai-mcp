function normalizeTargetArch(value, { allowUnknown = false } = {}) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['x64', 'amd64', 'x86_64'].includes(normalized)) return 'x64';
  if (['arm64', 'aarch64'].includes(normalized)) return 'arm64';
  if (allowUnknown) return normalized;
  throw new Error(`Unsupported architecture: ${normalized || '(empty)'}.`);
}

export { normalizeTargetArch };
