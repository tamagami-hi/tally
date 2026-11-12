import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createTallyServer, mcpHandler } from "../src/server.ts";
import { manyRepos, type RepoSource } from "../src/source.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import type { Repo } from "../../core/src/store/records.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked, type Tracked } from "../../core/tests/support/tracked.ts";

interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown>;
}

type Call = (name: string, args?: Record<string, unknown>) => Promise<Called>;

async function connect(from: Repo | RepoSource): Promise<Call> {
  const server = createTallyServer(from);
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

async function opened(call: Call, worktree: string, agent = "claude"): Promise<string> {
  const result = await call("session_open", { worktree, agent });
  if (result.isError) throw new Error(result.text);
  return result.structured["id"] as string;
}

async function serving(): Promise<Tracked & { call: Call; operator: string; data: string }> {
  const tracked = await makeTracked();
  const call = await connect(tracked.repo);
  return { ...tracked, call, operator: await opened(call, tracked.root, "operator"), data: await opened(call, tracked.trees["data"] ?? "") };
}

const helper = { name: "helper", purpose: "split the reader" };
const isThere = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

describe("track_open", () => {
  test("answers the new worktree and its runner, and a session opens there with no restart", async () => {
    const { call, root, data } = await serving();

    const made = await call("track_open", { sessionId: data, ...helper });

    const tree = join(root, ".temp/worktrees/helper");
    expect(made.isError).toBe(false);
    expect(made.structured).toMatchObject({ name: "helper", branch: "track/helper", worktree: tree, parent: "data", purpose: "split the reader", runner: join(tree, ".temp/tally/run"), commit: null });
    const session = await call("session_open", { worktree: tree, agent: "sonnet" });
    expect(session.structured).toMatchObject({ track: "helper", branch: "track/helper" });
  });

  test("lets the parent's session write its child's records, and no other track's", async () => {
    const { call, trees, data } = await serving();
    const engine = await opened(call, trees["engine"] ?? "", "kiro");
    await call("track_open", { sessionId: data, ...helper });

    const planned = await call("task_plan", { sessionId: data, milestone: "B2", track: "helper", tasks: ["h1 split"] });
    const refused = await call("task_plan", { sessionId: engine, milestone: "B2", track: "helper", tasks: ["h2 other"] });

    expect(planned.isError).toBe(false);
    expect(refused.text).toContain("may not write track helper's records");
  });

  test("refuses what the core refuses, in its words", async () => {
    const { call, data, operator } = await serving();

    expect((await call("track_open", { sessionId: data, ...helper, parent: "engine" })).text).toContain("may open only a child of data, not of engine");
    expect((await call("track_open", { sessionId: operator, ...helper, name: "data" })).text).toBe("the name data is taken; the tracks are data, engine");
  });
});

describe("track_list", () => {
  test("shows the config's tracks and the opened ones, to a caller with no session", async () => {
    const { call, root, data } = await serving();
    await call("track_open", { sessionId: data, ...helper, paths: ["src/reader"] });

    const listed = await call("track_list");

    expect(listed.structured["tracks"]).toEqual([
      { name: "data", branch: "track/data", worktree: join(root, ".temp/worktrees/data"), source: "config", hasSession: true },
      { name: "engine", branch: "track/engine", worktree: join(root, ".temp/worktrees/engine"), source: "config", hasSession: false },
      { name: "helper", branch: "track/helper", worktree: join(root, ".temp/worktrees/helper"), parent: "data", purpose: "split the reader", paths: ["src/reader"], source: "opened", hasSession: false },
    ]);
  });
});

describe("track_close", () => {
  test("is refused while a session is open on the track, then removes the worktree and the branch", async () => {
    const { call, root, data } = await serving();
    const made = await call("track_open", { sessionId: data, ...helper });
    const tree = made.structured["worktree"] as string;
    const session = await opened(call, tree, "sonnet");

    const refused = await call("track_close", { sessionId: data, name: "helper" });
    await call("session_close", { sessionId: session });
    const closed = await call("track_close", { sessionId: data, name: "helper" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(`track helper has an open session (sonnet, ${session}); close it first`);
    expect(closed.structured).toMatchObject({ name: "helper", closedAt: expect.any(String), commit: null });
    expect(await isThere(tree)).toBe(false);
    expect(await sh(root, ["branch", "--list", "track/helper"])).toBe("");
    expect((await call("track_list")).structured["tracks"]).toHaveLength(2);
    expect((await call("session_open", { worktree: root, track: "helper", agent: "x" })).text).toBe("no track 'helper'; known: main, data, engine");
  });
});

describe("a new track on a server for every repository", () => {
  test("is found from its folder, in the repository it was opened in", async () => {
    const home = await tmpDir("tally-home-");
    const alpha = await makeTracked();
    const beta = await makeTracked();
    await addRepo(home, { root: alpha.root, name: "alpha" });
    await addRepo(home, { root: beta.root, name: "beta" });
    const call = await connect(manyRepos(new Repos(home)));
    const data = await opened(call, beta.trees["data"] ?? "");

    const made = await call("track_open", { sessionId: data, ...helper });
    const session = await call("session_open", { worktree: made.structured["worktree"], agent: "sonnet" });

    expect(session.structured).toMatchObject({ track: "helper", repo: "beta" });
    expect((await call("track_list", { repo: "alpha" })).structured["tracks"]).toHaveLength(2);
    expect((await call("track_list", { repo: "beta" })).structured["tracks"]).toHaveLength(3);
  });
});

describe("the HTTP handler of one repository", () => {
  test("sees a track opened in an earlier request", async () => {
    const { repo, root } = await makeTracked();
    const handle = mcpHandler(repo);
    const post = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      const response = await handle(new Request("http://127.0.0.1/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body }));
      const answer = (await response.json()) as { result: { structuredContent?: Record<string, unknown>; content: { text: string }[] } };
      return answer.result.structuredContent ?? { refused: answer.result.content[0]?.text };
    };
    const operator = (await post("session_open", { worktree: root, agent: "operator" }))["id"];

    const made = await post("track_open", { sessionId: operator, ...helper });

    expect(await post("session_open", { worktree: made["worktree"], agent: "sonnet" })).toMatchObject({ track: "helper" });
  });
});
