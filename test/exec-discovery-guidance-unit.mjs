import assert from 'node:assert/strict';

import { getPublicToolSchemas } from '../src/tools/schema.js';

const tool = getPublicToolSchemas().find(item => item.name === 'relai_exec');
assert.ok(tool, 'relai_exec must remain present in the public MCP contract');
assert.equal(tool.inputSchema?.oneOf, undefined, 'relai_exec must expose a flat connector input schema');
assert.match(tool.description || '', /one-shot workspace commands/i);
assert.match(tool.description || '', /direct executable \+ argv.*command string/i);
assert.match(tool.inputSchema?.description || '', /direct executable \+ argv.*shell command/i);
assert.match(tool.inputSchema?.properties?.command?.description || '', /shell command/i);
assert.match(tool.inputSchema?.properties?.executable?.description || '', /shell:false/i);
assert.ok(tool.inputSchema?.properties?.argv, 'relai_exec discovery must keep argv callable');
assert.match(tool.inputSchema?.properties?.input?.description || '', /multiline scripts or structured text/i);
console.log('ChatGPT-facing relai_exec first-call direct-mode guidance passed.');
