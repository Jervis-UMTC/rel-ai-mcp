import assert from 'node:assert/strict';

import { STATIC_CONTEXT } from '../../src/context/static-context.js';
import { PUBLIC_MCP_SERVER_INSTRUCTIONS } from '../../src/mcp/serverInstructions.js';

assert.ok(PUBLIC_MCP_SERVER_INSTRUCTIONS.startsWith(STATIC_CONTEXT), 'server instructions must begin with the canonical static context');
assert.ok(Buffer.byteLength(STATIC_CONTEXT, 'utf8') < 2000, 'static context must remain small');
assert.doesNotMatch(STATIC_CONTEXT, /changelog|previous fix|release history|example:/i, 'static context must not accumulate project history or examples');
assert.match(STATIC_CONTEXT, /work_id/);
assert.match(STATIC_CONTEXT, /authorization/i);
assert.match(STATIC_CONTEXT, /validation is factual evidence/i);
assert.match(STATIC_CONTEXT, /AI-host native capability/i);
assert.match(STATIC_CONTEXT, /Rel\.AI computer control/i);

console.log('Static context stays small and contains only universal runtime and capability-routing invariants.');
