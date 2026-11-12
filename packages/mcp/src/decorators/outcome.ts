import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Decorator } from "../decorate.ts";

export const WAITING = "waiting";

type Answer = Record<string, unknown>;

const JSON_INDENT = 2;

const asText = (answer: Answer): string => JSON.stringify(answer, null, JSON_INDENT);

function written(args: Answer, result: CallToolResult): Answer | undefined {
  const answer = result.structuredContent;
  if (typeof args["sessionId"] !== "string" || result.isError === true || answer === undefined) return undefined;
  if (!("commit" in answer) || answer["recorded"] === false) return undefined;
  return typeof answer["commit"] === "string" || answer["commit"] === null ? answer : undefined;
}

export const outcome: Decorator = async ({ args, result }) => {
  const answer = written(args, result);
  if (answer === undefined) return result;
  const told = { ...answer, done: true, records: answer["commit"] ?? WAITING };
  const content = result.content.map((part) => (part.type === "text" && part.text === asText(answer) ? { ...part, text: asText(told) } : part));
  return { ...result, content, structuredContent: told };
};
