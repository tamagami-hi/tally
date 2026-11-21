import { createHash } from "node:crypto";
import type { Hono } from "hono";

export const BARE_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

export interface Surface {
  tools: number;
  characters: number;
  sha256: string;
}

interface Answer {
  result?: { tools?: unknown[]; content?: { text?: string }[]; isError?: boolean };
  error?: { code: number; message: string };
}

export const ADDRESSES = ["/mcp", "/mcp/builder", "/mcp/reviewer", "/r/alpha/mcp", "/r/alpha/mcp/builder", "/r/alpha/mcp/reviewer"] as const;

export const bare = (app: Hono, path: string, method: string, params: Record<string, unknown>): Promise<Response> =>
  Promise.resolve(app.request(path, { method: "POST", headers: BARE_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));

export const bareCall = (app: Hono, path: string, name: string, args: Record<string, unknown> = {}): Promise<Response> => bare(app, path, "tools/call", { name, arguments: args });

export async function answerOf(response: Response): Promise<Answer> {
  return JSON.parse(await response.text()) as Answer;
}

export const joinedText = (answer: Answer): string => (answer.result?.content ?? []).map((part) => part.text ?? "").join("\n");

export function surfaceOf(tools: readonly unknown[]): Surface {
  const text = JSON.stringify(tools);
  return { tools: tools.length, characters: text.length, sha256: createHash("sha256").update(text).digest("hex") };
}

export async function bareSurface(app: Hono, path: string): Promise<Surface> {
  return surfaceOf((await answerOf(await bare(app, path, "tools/list", {}))).result?.tools ?? []);
}
