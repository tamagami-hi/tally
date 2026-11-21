import { Client, InMemoryTransport, ProtocolError } from "@modelcontextprotocol/client";
import { createTallyServer } from "../../src/server.ts";
import type { RepoSource } from "../../src/source.ts";
import type { Repo } from "../../../core/src/store/records.ts";
import type { CommandPlace } from "../../../core/src/land/where.ts";
import { DECORATORS } from "../../src/decorate.ts";
import type { Role } from "../../src/roles.ts";

export interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown>;
  code?: number;
}

export type Call = (name: string, args?: Record<string, unknown>) => Promise<Called>;

export async function connect(from: Repo | RepoSource, place?: CommandPlace, role?: Role): Promise<{ client: Client; call: Call }> {
  const server = createTallyServer(from, DECORATORS, place, undefined, role);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call: Call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }).catch((error: unknown) => {
      if (error instanceof ProtocolError) return { content: [{ type: "text", text: error.message }], isError: true, code: error.code };
      throw error;
    });
    const content = result.content as { type: string; text?: string }[];
    return { text: content.map((c) => c.text ?? "").join("\n"), isError: result.isError === true, structured: (result.structuredContent ?? {}) as Record<string, unknown>, ...("code" in result && typeof result.code === "number" ? { code: result.code } : {}) };
  };
  return { client, call };
}

export async function opened(call: Call, worktree: string, agent = "claude"): Promise<string> {
  const result = await call("session_open", { worktree, agent });
  if (result.isError) throw new Error(result.text);
  return result.structured["id"] as string;
}

export const keepingContextAsRecords = (repo: Repo): Repo => ({ ...repo, config: { ...repo.config, context: "records" } });
