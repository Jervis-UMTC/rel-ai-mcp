import { STATIC_CONTEXT } from '../context/static-context.js';

const PUBLIC_MCP_SERVER_INSTRUCTIONS = `${STATIC_CONTEXT} work_id omission never selects another task. Use brief normal assistant progress messages around tools. Native tool invocation labels are supplemental status only. Summarize; do not expose private chain-of-thought. Do not poll relai_work status merely to refresh UI.`;

export { PUBLIC_MCP_SERVER_INSTRUCTIONS };
