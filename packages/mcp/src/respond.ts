import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { messageOf } from "@tally/core";

export function ok(value: unknown, text?: string): CallToolResult {
  const body = text ?? (typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const structured = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
  return { content: [{ type: "text", text: body }], structuredContent: structured };
}

export function refused(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: messageOf(error) }] };
}

export async function attempt(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error: unknown) {
    return refused(error);
  }
}
