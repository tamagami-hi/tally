import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const OPENS = "session_open";

export function sessionOf(tool: string, args: Record<string, unknown>, result: CallToolResult): string | undefined {
  const given = args["sessionId"];
  if (typeof given === "string") return given;
  const opened = tool === OPENS ? result.structuredContent?.["id"] : undefined;
  return typeof opened === "string" ? opened : undefined;
}
