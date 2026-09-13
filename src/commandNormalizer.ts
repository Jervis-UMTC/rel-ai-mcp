const KNOWN_RUNNABLE_PREFIXES = new Set([
  'npm', 'yarn', 'pnpm', 'npx',
  'make', 'go', 'cargo',
  'flutter', 'dart',
  'python', 'python3', 'pytest',
  'jest', 'mocha', 'vitest',
  'node', 'deno', 'bun',
  'echo', 'sh', 'bash',
]);

interface NormalizedCommand {
  readonly command: string;
  readonly normalized: boolean;
  readonly warning?: string;
  readonly originalValue?: string;
}

function normalizeCommandAlias(commandKey: unknown, commandValue: unknown, discoveredCommands: unknown): NormalizedCommand {
  const value = String(commandValue ?? '').trim();
  const key = String(commandKey ?? '').trim();
  const disc = discoveredCommands && typeof discoveredCommands === 'object' && !Array.isArray(discoveredCommands)
    ? discoveredCommands as Readonly<Record<string, string>>
    : {};

  if (!value) {
    return { command: key, normalized: false, warning: 'empty command value' };
  }

  if (Object.hasOwn(disc, key)) {
    return { command: disc[key] ?? key, normalized: true, originalValue: value };
  }

  if (Object.values(disc).includes(value)) {
    return { command: value, normalized: false };
  }

  const firstWord = (value.split(/\s+/, 1)[0] ?? '').toLowerCase();
  if (KNOWN_RUNNABLE_PREFIXES.has(firstWord)) {
    return { command: value, normalized: false };
  }

  return {
    command: value,
    normalized: false,
    warning: 'command not found in discovered commands — may be stale'
  };
}

export { normalizeCommandAlias };
