import { STATIC_CONTEXT } from '../context/static-context.js';

const PUBLIC_MCP_SERVER_INSTRUCTIONS = `${STATIC_CONTEXT} work_id omission never selects another task. When a workspace-resolution error returns workspaceAliases, use those authorized aliases as recovery candidates and retry with an explicit alias when the intended workspace is clear; do not ask for a filesystem path that Rel.AI already knows. Do not silently choose among multiple genuinely ambiguous workspaces. Use brief normal assistant progress messages around tools. Native tool invocation labels are supplemental status only. Summarize; do not expose private chain-of-thought. Do not poll relai_work status merely to refresh UI.`;

export { PUBLIC_MCP_SERVER_INSTRUCTIONS };
