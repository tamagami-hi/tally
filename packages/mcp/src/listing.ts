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

const SAYS_NOTHING: Readonly<Record<string, unknown>> = { additionalProperties: false, maximum: Number.MAX_SAFE_INTEGER, minimum: Number.MIN_SAFE_INTEGER };

function withoutClosed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutClosed);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key, held]) => !(key in SAYS_NOTHING && SAYS_NOTHING[key] === held)).map(([key, held]) => [key, withoutClosed(held)]));
}

export function inputOf(schema: z.ZodObject): Tool["inputSchema"] {
  const { $schema: _left, ...input } = toJsonSchemaCompat(schema, { strictUnions: true, pipeStrategy: "input" });
  return withoutClosed(input) as Tool["inputSchema"];
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
