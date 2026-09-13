export const MCP_CONTENT_TYPES = Object.freeze({ TEXT: 'text', IMAGE: 'image', RESOURCE_LINK: 'resource_link' } as const);

export interface McpTextContent { type: typeof MCP_CONTENT_TYPES.TEXT; text: string }
export interface McpImageContent { type: typeof MCP_CONTENT_TYPES.IMAGE; data: string; mimeType: string }
export interface McpResourceLinkContent { type: typeof MCP_CONTENT_TYPES.RESOURCE_LINK; uri: string; name: string; description?: string; mimeType?: string; size?: number }
export type McpContent = McpTextContent | McpImageContent | McpResourceLinkContent;

export interface McpToolResultDto<T extends Record<string, unknown> = Record<string, unknown>> {
  content: McpContent[];
  structuredContent: T;
  isError: boolean;
  _meta?: Record<string, unknown>;
}
