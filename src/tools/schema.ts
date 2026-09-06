import type { JsonSchema } from '../../types/boundaries.d.ts';
import type { CatalogToolDefinition } from './actionDefinitions.ts';
import type { CatalogTool, ToolActionCatalogEntry } from './actionCatalog.ts';
import { getCatalogToolDefinition, getCatalogToolDefinitions, getCatalogTools } from './actionCatalog.ts';
import { executableInputSchema } from './executableSchema.js';
import { getToolGroups, getToolMetadata, getToolSurfaceManifest } from './surface.js';
import { compactPublicInputSchema } from './publicSchema.js';
import { toolUiMetadata } from '../mcp/appUi.js';
import { LOCAL_DEVELOPER_SECURITY_SCHEMES } from '../mcp/localDeveloperMode.js';

type OutputJsonSchema = JsonSchema & { allOf?: JsonSchema[] };

type ToolSchema = Readonly<{
  name: string;
  title: string;
  description: string;
  inputSchema: CatalogToolDefinition['inputSchema'];
  outputSchema: JsonSchema;
  annotations: CatalogToolDefinition['annotations'];
}>;

type PublicToolSchema = ToolSchema & Readonly<{ _meta: Readonly<Record<string, unknown>> }>;

const toolDefinitions = getCatalogToolDefinitions();
const catalogToolByName = new Map<string, CatalogTool>(getCatalogTools().map(tool => [tool.definition.name, tool]));
const TOOL_NAMES: readonly string[] = Object.freeze(toolDefinitions.map(definition => definition.name));
const PUBLIC_DISCOVERY_OUTPUT_FIELDS: readonly string[] = Object.freeze(['ok']);
// Keep schema object identity stable for the lifetime of the process. The MCP SDK
// caches JSON-schema adapters by object identity, so rebuilding equivalent objects
// on every stateless request defeats that cache and adds tens of milliseconds.
const toolSchemas: readonly ToolSchema[] = Object.freeze(toolDefinitions.map(definition => Object.freeze(buildToolSchema(definition))));
const publicToolSchemas: readonly PublicToolSchema[] = Object.freeze(toolDefinitions.map(definition => Object.freeze(buildPublicToolSchema(definition))));
const mcpToolSchemas = publicToolSchemas;

function getToolSchemas(): readonly ToolSchema[] {
  return toolSchemas;
}

function getPublicToolSchemas(): readonly PublicToolSchema[] {
  return publicToolSchemas;
}

function getMcpToolSchemas(): readonly PublicToolSchema[] {
  return mcpToolSchemas;
}

function buildPublicToolSchema(definition: CatalogToolDefinition): PublicToolSchema {
  const schema = buildToolSchema(definition);
  const uiMetadata = toolUiMetadata(schema.name) as Record<string, unknown> | null | undefined;
  const meta = Object.freeze({
    securitySchemes: LOCAL_DEVELOPER_SECURITY_SCHEMES,
    ...(uiMetadata || {}),
    ...(schema.name === 'relai_edit' ? { 'openai/fileParams': ['file'] } : {})
  });
  return {
    ...schema,
    annotations: schema.annotations,
    _meta: meta,
    inputSchema: compactPublicInputSchema(schema.name, schema.inputSchema, catalogToolByName.get(schema.name)) as CatalogToolDefinition['inputSchema'],
    outputSchema: compactPublicOutputSchema(schema.outputSchema)
  };
}

function buildToolSchema(definition: CatalogToolDefinition): ToolSchema {
  const catalogTool = catalogToolByName.get(definition.name);
  const schema: ToolSchema = {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: executableInputSchema(definition, catalogTool) as CatalogToolDefinition['inputSchema'],
    outputSchema: definition.outputSchema,
    annotations: definition.annotations
  };
  if (!catalogTool?.actions?.length) return schema;
  return { ...schema, outputSchema: publicOutputSchema(catalogTool.actions) };
}

function compactPublicOutputSchema(schema: JsonSchema): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const name of PUBLIC_DISCOVERY_OUTPUT_FIELDS) {
    const field = schema?.properties?.[name];
    if (field) properties[name] = field;
  }
  return {
    type: 'object',
    properties,
    required: ['ok'],
    additionalProperties: true
  };
}

function publicOutputSchema(actions: readonly ToolActionCatalogEntry[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const action of actions) collectOutputProperties(action.outputSchema, properties);
  return {
    type: 'object',
    properties,
    required: ['ok'],
    additionalProperties: false
  };
}

function collectOutputProperties(schema: JsonSchema | undefined, target: Record<string, JsonSchema>): void {
  if (!schema || typeof schema !== 'object') return;
  for (const [name, fieldSchema] of Object.entries(schema.properties || {})) {
    if (!Object.hasOwn(target, name)) target[name] = fieldSchema;
  }
  const recursiveSchema = schema as OutputJsonSchema;
  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    for (const branch of recursiveSchema[keyword] || []) collectOutputProperties(branch, target);
  }
}

function getToolDefinitions(): readonly CatalogToolDefinition[] {
  return toolDefinitions;
}

function getToolNames(): readonly string[] {
  return TOOL_NAMES;
}

function isToolCallable(name: string): boolean {
  return Boolean(getCatalogToolDefinition(name));
}

export {
  TOOL_NAMES,
  getMcpToolSchemas,
  getPublicToolSchemas,
  getToolDefinitions,
  getToolGroups,
  getToolMetadata,
  getToolNames,
  getToolSchemas,
  getToolSurfaceManifest,
  isToolCallable,
  toolSchemas
};
