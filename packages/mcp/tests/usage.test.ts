import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, test } from "vitest";
import { Usage, USAGE_FILE } from "../../core/src/usage/counts.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { DECORATORS } from "../src/decorate.ts";
import { createTallyServer } from "../src/server.ts";
import { listedEntries } from "../src/server.ts";
import { usageRanking } from "../src/usage.ts";
import type { Decorator } from "../src/decorate.ts";
import { opened } from "./support/connect.ts";

const SECRET = "a-value-only-the-caller-knows";

async function counting(decorators: readonly Decorator[] = DECORATORS) {
  const tracked = await makeTracked();
  const usage = await Usage.open(join(await tmpDir("tally-usage-"), USAGE_FILE), "0.7.0");
  const server = createTallyServer(tracked.repo, decorators, "service", usage);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { ...tracked, usage, call };
}

describe("what tally counts of each call", () => {
  test("a read, a write, a refusal and a call the schema refused, with its scope and repository", async () => {
    const { usage, call, trees, repo } = await counting();
    const data = (await call("session_open", { worktree: trees["data"]!, agent: "claude" })).structuredContent?.["id"] as string;

    await call("board_get", {});
    await call("task_claim", { sessionId: data, milestone: "B2", task: "4 manifest" });
    await call("task_claim", { sessionId: data, milestone: "B2", task: "no such task" });
    await call("task_claim", { sessionId: data, milestone: "B2", task: "4 manifest", nonsense: SECRET });

    const tools = usage.snapshot().tools;
    expect(tools["board_get"]).toMatchObject({ calls: 1, refused: 0, invalid: 0, by: { none: 1 }, repos: { [repo.name]: 1 } });
    expect(tools["task_claim"]).toMatchObject({ calls: 2, refused: 1, invalid: 1, by: { track: 2 }, repos: { [repo.name]: 2 } });
    expect(tools["session_open"]).toMatchObject({ calls: 1, by: { track: 1 } });
  });

  test("an answer the size limit cut", async () => {
    const big: Decorator = async ({ result }) => ({ ...result, content: [{ type: "text", text: "x".repeat(30_000) }], structuredContent: { rows: Array.from({ length: 400 }, (_, i) => ({ id: i, text: "y".repeat(80) })) } });
    const { usage, call } = await counting([big, ...DECORATORS]);

    await call("board_get", {});

    expect(usage.snapshot().tools["board_get"]).toMatchObject({ calls: 1, cut: 1 });
  });

  test("keeps no argument, no answer and no session id in its file", async () => {
    const { usage, call, trees } = await counting();
    const data = await opened(async (name, args) => {
      const result = await call(name, args);
      return { text: "", isError: result.isError === true, structured: (result.structuredContent ?? {}) as Record<string, unknown> };
    }, trees["data"]!);

    await call("note_post", { sessionId: data, to: "all", kind: "heads-up", text: SECRET });
    await call("task_claim", { sessionId: data, milestone: SECRET, task: SECRET });
    await usage.flush();
    const written = await readFile(usage.path, "utf8");

    expect(written).not.toContain(SECRET);
    expect(written).not.toContain(data);
  });
});

describe("the ranking", () => {
  test("the most called first, each with the characters it costs in the list, and the tools never called", async () => {
    const { usage, call } = await counting();
    await call("board_get", {});
    await call("board_get", {});
    await call("ledger_check", {});
    const entries = listedEntries("service");

    const ranking = usageRanking(usage.snapshot(), entries);
    const chars = (name: string): number => JSON.stringify(entries.find((entry) => entry.name === name)).length;

    expect(ranking.tools.map((tool) => [tool.name, tool.calls])).toEqual([["board_get", 2], ["ledger_check", 1]]);
    expect(ranking.tools[0]).toMatchObject({ listed: true, chars: chars("board_get") });
    expect(ranking.never.tools).toContain("task_claim");
    expect(ranking.never.tools).not.toContain("board_get");
    expect(ranking.never.chars).toBe(ranking.never.tools.reduce((sum, name) => sum + chars(name), 0));
    expect(ranking.versions).toEqual([{ version: "0.7.0", since: ranking.since }]);
  });

  test("keeps a tool counted and no longer listed, marked as not listed", () => {
    const at = "2026-11-20T09:00:00.000Z";
    const count = { calls: 3, refused: 0, cut: 0, invalid: 0, first: at, last: at, days: 1, lastDay: "2026-11-20", by: { none: 3 }, via: {}, repos: { alpha: 3 } };

    const ranking = usageRanking({ schema: 1, since: at, versions: [], tools: { old_tool: count } }, listedEntries("service"));

    expect(ranking.tools).toEqual([expect.objectContaining({ name: "old_tool", listed: false, chars: 0, calls: 3 })]);
  });
});
