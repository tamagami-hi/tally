import type { CallToolResult as AnyCallToolResult } from "@modelcontextprotocol/server";
import { messageOf } from "@tally/core";

export type CallToolResult = AnyCallToolResult & { structuredContent?: Record<string, unknown> };

export const jsonText = (value: unknown): string => JSON.stringify(value);

export function ok(value: unknown, text?: string): CallToolResult {
  const body = text ?? (typeof value === "string" ? value : jsonText(value));
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
