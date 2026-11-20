import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

const placed = (issue: z.core.$ZodIssue): string => (issue.path.length === 0 ? issue.message : `${issue.message} at ${issue.path.join(".")}`);

export function invalidInput(tool: string, error: z.ZodError): CallToolResult {
  const text = `Invalid arguments for tool ${tool}: ${error.issues.map(placed).join("\n")}`;
  return { content: [{ type: "text", text }], isError: true };
}
