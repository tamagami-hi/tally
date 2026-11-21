import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, test } from "vitest";
import type { Decorator } from "../src/decorate.ts";
import { createTallyServer } from "../src/server.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

async function calling(decorators: readonly Decorator[]) {
  const { repo } = await makeTracked();
  const server = createTallyServer(repo, decorators);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })).structuredContent as Record<string, unknown>;
}

describe("what is added to every tool's answer", () => {
  test("is added by each decorator in turn, which sees the tool and its arguments", async () => {
    const seen: string[] = [];
    const first: Decorator = async ({ tool, args, result }) => {
      seen.push(`${tool} ${JSON.stringify(args)}`);
      return { ...result, structuredContent: { ...result.structuredContent, first: true } };
    };
    const second: Decorator = async ({ result }) => ({ ...result, structuredContent: { ...result.structuredContent, order: Object.keys(result.structuredContent ?? {}).includes("first") ? "after the first" : "before it" } });
    const call = await calling([first, second]);

    const answer = await call("session_list", { repo: undefined });

    expect(answer["sessions"]).toEqual([]);
    expect(answer["first"]).toBe(true);
    expect(answer["order"]).toBe("after the first");
    expect(seen).toEqual(["session_list {}"]);
  });

  test("is nothing when there are no decorators", async () => {
    const call = await calling([]);

    expect(await call("session_list")).toEqual({ sessions: [] });
  });
});
