import assert from 'node:assert/strict';
import fs from 'node:fs';

const transportSource = fs.readFileSync(new URL('../src/http/mcpTransport.ts', import.meta.url), 'utf8');
const coreSource = fs.readFileSync(new URL('../src/core/mcp-runtime.ts', import.meta.url), 'utf8');
const policy = fs.readFileSync(new URL('../docs/MCP_PROTOCOL_POLICY.md', import.meta.url), 'utf8');

assert.match(transportSource, /async function handleLegacyMcpRequest\s*\(/, 'legacy HTTP compatibility must have one named adapter');
assert.match(
  transportSource,
  /if \(legacy\) \{[\s\S]*?LEGACY_LIFECYCLE_METHODS\.includes\(method\)[\s\S]*?await handleLegacyMcpRequest\([\s\S]*?\);\s*return;\s*\}/,
  'the main HTTP dispatcher must admit only startup lifecycle methods before delegating to the legacy adapter'
);
assert.match(transportSource, /observeMcpRequestManifest/, 'HTTP must delegate manifest observation to Core');
assert.match(coreSource, /function observeMcpRequestManifest\s*\(/, 'manifest observation must remain shared in Core');
assert.match(coreSource, /function runMcpRequestSpan(?:<[^>]+>)?\s*\(/, 'request telemetry must remain shared in Core');
assert.equal((transportSource.match(/getCoreNodeHandler\(\)\(ctx\.req[^\n]*ctx\.res, message\)/g) || []).length, 2, 'modern and startup-legacy SDK dispatch must each remain explicit');

assert.match(policy, /Modern MCP protocol for ordinary requests:\s*`2026-07-28`/);
assert.match(policy, /Stateless ChatGPT HTTP startup compatibility:\s*`2025-11-25`/);
assert.match(policy, /stdio tests verify that stdio remains modern-only/i);
assert.match(policy, /Removal condition:/);
assert.match(policy, /startup lifecycle/i);
assert.match(transportSource, /LEGACY_LIFECYCLE_METHODS\.includes\(method\)/, 'legacy HTTP compatibility must reject ordinary MCP methods before SDK dispatch');
assert.match(transportSource, /compatibility is limited to initialize lifecycle requests/, 'legacy ordinary-method rejection must explain the modern cutover');

console.log('Legacy MCP compatibility is isolated to the stateless ChatGPT startup lifecycle.');
