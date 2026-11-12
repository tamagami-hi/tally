import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Decorator } from "../../src/decorate.ts";
import { createTallyServer } from "../../src/server.ts";
import type { Repo } from "../../../core/src/store/records.ts";

export interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown>;
}

export type Call = (name: string, args?: Record<string, unknown>) => Promise<Called>;

export async function serving(repo: Repo, decorators?: readonly Decorator[]): Promise<Call> {
  const server = createTallyServer(repo, decorators);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    return { text: content.map((c) => c.text ?? "").join("\n"), isError: result.isError === true, structured: (result.structuredContent ?? {}) as Record<string, unknown> };
  };
}

export async function sessionOn(call: Call, worktree: string, agent = "a"): Promise<string> {
  const opened = await call("session_open", { worktree, agent });
  if (opened.isError) throw new Error(opened.text);
  return opened.structured["id"] as string;
}

export interface BoardTask {
  id: string;
  [field: string]: unknown;
}

export interface BoardRow {
  id: string;
  notes: string[];
  tasks: BoardTask[];
  [field: string]: unknown;
}

export async function rowOf(call: Call, milestone: string): Promise<BoardRow> {
  const rows = (await call("board_get")).structured["rows"] as BoardRow[];
  const row = rows.find((one) => one.id === milestone);
  if (row === undefined) throw new Error(`the board has no row ${milestone}`);
  return row;
}

export async function taskOf(call: Call, milestone: string, task: string): Promise<BoardTask> {
  const found = (await rowOf(call, milestone)).tasks.find((one) => one.id === task);
  if (found === undefined) throw new Error(`${milestone} has no task ${task}`);
  return found;
}
