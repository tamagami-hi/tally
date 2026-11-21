import { BARE_HEADERS } from "./wire.ts";
import { newerInit } from "../../../mcp/tests/support/newer.ts";

export const REVISIONS = ["2025-11-25", "2026-07-28"] as const;
export type Revision = (typeof REVISIONS)[number];

export interface Called {
  isError: boolean;
  text: string;
  structured: Record<string, unknown>;
}

export type Fetching = (request: Request) => Promise<Response>;

interface Answer {
  result?: { content?: { text?: string }[]; isError?: boolean; structuredContent?: Record<string, unknown>; tools?: { name: string }[]; resultType?: string };
  error?: { message: string };
}

const AT = "http://127.0.0.1";

function requestFor(path: string, revision: Revision, method: string, params: Record<string, unknown>): Request {
  if (revision === "2026-07-28") return new Request(`${AT}${path}`, newerInit(method, params));
  return new Request(`${AT}${path}`, { method: "POST", headers: BARE_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}

async function answered(fetching: Fetching, path: string, revision: Revision, method: string, params: Record<string, unknown>): Promise<Answer> {
  const answer = (await (await fetching(requestFor(path, revision, method, params))).json()) as Answer;
  if (revision === "2026-07-28" && answer.result !== undefined && answer.result.resultType !== "complete") throw new Error(`${method} at ${path} was not answered on 2026-07-28`);
  return answer;
}

export function callerAt(fetching: Fetching, path: string, revision: Revision): (name: string, args?: Record<string, unknown>) => Promise<Called> {
  return async (name, args = {}) => {
    const answer = await answered(fetching, path, revision, "tools/call", { name, arguments: args });
    if (answer.error !== undefined) return { isError: true, text: answer.error.message, structured: {} };
    const text = (answer.result?.content ?? []).map((part) => part.text ?? "").join("\n");
    return { isError: answer.result?.isError === true, text, structured: answer.result?.structuredContent ?? {} };
  };
}

export async function namesAt(fetching: Fetching, path: string, revision: Revision): Promise<string[]> {
  return ((await answered(fetching, path, revision, "tools/list", {})).result?.tools ?? []).map((tool) => tool.name).sort();
}

export const requestAt = requestFor;
