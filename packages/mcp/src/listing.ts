import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { ListToolsRequestSchema, type Tool, type ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export interface ListedTool {
  name: string;
  title: string;
  description?: string | undefined;
  inputSchema: z.ZodObject;
  annotations: ToolAnnotations;
}

type Hint = "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint";

const PROTOCOL_DEFAULTS: Readonly<Record<Hint, boolean>> = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const ONLY_WHEN_WRITING: readonly Hint[] = ["destructiveHint", "idempotentHint"];
const HINTS = Object.keys(PROTOCOL_DEFAULTS) as Hint[];

export function hintsOf(annotations: ToolAnnotations): ToolAnnotations {
  const reads = annotations.readOnlyHint === true;
  const said = HINTS.filter((hint) => !(reads && ONLY_WHEN_WRITING.includes(hint))).filter((hint) => annotations[hint] !== undefined && annotations[hint] !== PROTOCOL_DEFAULTS[hint]);
  return Object.fromEntries(said.map((hint) => [hint, annotations[hint]]));
}

export function inputOf(schema: z.ZodObject): Tool["inputSchema"] {
  const { $schema: _left, ...input } = toJsonSchemaCompat(schema, { strictUnions: true, pipeStrategy: "input" });
  return input as Tool["inputSchema"];
}

export function listEntry(tool: ListedTool): Tool {
  return {
    name: tool.name,
    title: tool.title,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: inputOf(tool.inputSchema),
    annotations: hintsOf(tool.annotations),
  };
}

export function listing(server: McpServer, tools: readonly ListedTool[]): void {
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: tools.map(listEntry) }));
}
