import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

const placed = (issue: z.core.$ZodIssue): string => (issue.path.length === 0 ? issue.message : `${issue.message} at ${issue.path.join(".")}`);

const HINTS: readonly { applies: (tool: string, keys: readonly string[], params: readonly string[]) => boolean; says: string }[] = [
  { applies: (_tool, keys, params) => keys.includes("repo") && params.includes("sessionId") && !params.includes("repo"), says: "a writing tool takes sessionId; its repository is its session's" },
  { applies: (tool, keys) => tool === "session_open" && keys.includes("cwd"), says: "session_open takes worktree: the folder you work in" },
];

export function unknownArguments(tool: string, params: readonly string[], keys: readonly string[]): string {
  const hints = HINTS.filter((hint) => hint.applies(tool, keys, params)).map((hint) => `; ${hint.says}`).join("");
  return `${tool} takes no ${keys.map((key) => `'${key}'`).join(", ")}; it takes ${params.join(", ")}${hints}`;
}

export function invalidInput(tool: string, error: z.ZodError): CallToolResult {
  const text = `Invalid arguments for tool ${tool}: ${error.issues.map(placed).join("\n")}`;
  return { content: [{ type: "text", text }], isError: true };
}
