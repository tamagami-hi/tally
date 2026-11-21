import { mkdir, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, test } from "vitest";
import { createTallyServer } from "../src/server.ts";
import { manyRepos } from "../src/source.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { Records } from "../../core/src/store/records.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked, type Tracked } from "../../core/tests/support/tracked.ts";

interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown>;
}

type Call = (name: string, args?: Record<string, unknown>) => Promise<Called>;

interface Serving {
  home: string;
  repos: Repos;
  client: Client;
  call: Call;
  alpha: Tracked;
  beta: Tracked;
}

async function serving(): Promise<Serving> {
  const home = await tmpDir("tally-home-");
  const alpha = await makeTracked();
  const beta = await makeTracked();
  await addRepo(home, { root: alpha.root, name: "alpha" });
  await addRepo(home, { root: beta.root, name: "beta" });
  const repos = new Repos(home);
  const server = createTallyServer(manyRepos(repos));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call: Call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    return { text: content.map((c) => c.text ?? "").join("\n"), isError: result.isError === true, structured: (result.structuredContent ?? {}) as Record<string, unknown> };
  };
  return { home, repos, client, call, alpha, beta };
}

const tree = (tracked: Tracked, track: string): string => tracked.trees[track] ?? "";

async function opened(call: Call, worktree: string, agent = "claude"): Promise<string> {
  const result = await call("session_open", { worktree, agent });
  if (result.isError) throw new Error(result.text);
  return result.structured["id"] as string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("one MCP server for every repository", () => {
  test("says how to begin without naming one repository", async () => {
    const { client } = await serving();

    expect(client.getInstructions()).toContain("session_open");
    expect(client.getInstructions()).not.toContain("Test");
  });

  test("lists the repositories it serves", async () => {
    const { call, alpha, beta } = await serving();
    await opened(call, tree(beta, "data"));

    const { structured } = await call("repo_list");

    expect(structured["repos"]).toEqual([
      { name: "alpha", root: alpha.root, project: "Test", sessions: 0, isDefault: true },
      { name: "beta", root: beta.root, project: "Test", sessions: 1, isDefault: false },
    ]);
  });
});

describe("session_open on a server for every repository", () => {
  test("finds the repository and the track from the worktree alone", async () => {
    const { home, call, beta } = await serving();

    const { structured } = await call("session_open", { worktree: tree(beta, "data"), agent: "claude" });

    expect(structured["track"]).toBe("data");
    expect(structured["worktree"]).toBe(tree(beta, "data"));
    expect(structured["repo"]).toBe("beta");
    expect(await exists(join(home, "state/beta/sessions.json"))).toBe(true);
    expect(await exists(join(home, "state/alpha/sessions.json"))).toBe(false);
  });

  test("writes the runner into the worktree and names it", async () => {
    const { call, beta } = await serving();

    const { structured } = await call("session_open", { worktree: tree(beta, "data"), agent: "claude" });

    expect(structured["runner"]).toBe(join(tree(beta, "data"), ".temp/tally/run"));
    expect(await exists(join(tree(beta, "data"), ".temp/tally/run"))).toBe(true);
  });

  test("finds them from a folder inside the worktree", async () => {
    const { call, alpha } = await serving();
    const inside = join(tree(alpha, "engine"), "src", "deep");
    await mkdir(inside, { recursive: true });

    const { structured } = await call("session_open", { worktree: inside, agent: "claude" });

    expect(structured["track"]).toBe("engine");
    expect(structured["worktree"]).toBe(tree(alpha, "engine"));
  });

  test("finds them through a link to the worktree", async () => {
    const { call, beta } = await serving();
    const link = join(await tmpDir("tally-link-"), "linked");
    await symlink(tree(beta, "data"), link);

    const { structured } = await call("session_open", { worktree: link, agent: "claude" });

    expect(structured["repo"]).toBe("beta");
    expect(structured["worktree"]).toBe(tree(beta, "data"));
  });

  test("gives operator scope at the repository's own checkout", async () => {
    const { call, alpha } = await serving();

    const { structured } = await call("session_open", { worktree: alpha.root, agent: "claude" });

    expect(structured["track"]).toBe("main");
  });

  test("refuses a track that is not the worktree's", async () => {
    const { call, alpha } = await serving();

    const refused = await call("session_open", { worktree: tree(alpha, "data"), track: "engine", agent: "claude" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("is not the worktree of track engine");
  });

  test("refuses a repository that is not listed, and says how to list it", async () => {
    const { call } = await serving();
    const stranger = await makeTracked();

    const refused = await call("session_open", { worktree: tree(stranger, "data"), agent: "claude" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`${stranger.root} is not a repository tally tracks`);
  });
});

describe("a tool that carries a session", () => {
  test("writes to its session's repository and to no other", async () => {
    const { call, repos, beta } = await serving();
    const session = await opened(call, tree(beta, "data"));

    const planned = await call("task_plan", { sessionId: session, milestone: "B2", tasks: ["6 only in beta"] });

    expect(planned.isError).toBe(false);
    const tasksOf = async (name: string): Promise<string[]> => (await new Records(await repos.get(name)).readLedger()).milestones.flatMap((m) => m.tasks.map((t) => t.id));
    expect(await tasksOf("beta")).toContain("6 only in beta");
    expect(await tasksOf("alpha")).not.toContain("6 only in beta");
  });

  test("holds a lock in its own repository only", async () => {
    const { call, alpha, beta } = await serving();
    const inBeta = await opened(call, tree(beta, "data"));
    await opened(call, tree(alpha, "data"));

    await call("lock_acquire", { sessionId: inBeta, name: "evidence", note: "a run" });

    const held = async (repo: string): Promise<unknown[]> => (await call("lock_list", { repo })).structured["locks"] as unknown[];
    expect(await held("beta")).toHaveLength(1);
    expect(await held("alpha")).toHaveLength(0);
  });

  test("is refused once its session is closed", async () => {
    const { call, beta } = await serving();
    const session = await opened(call, tree(beta, "data"));
    await call("session_close", { sessionId: session });

    const refused = await call("ledger_check", { sessionId: session });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(`no session ${session}; open one with session_open`);
  });

  test("is refused for a session nobody opened", async () => {
    const { call } = await serving();

    const refused = await call("task_claim", { sessionId: "nope", milestone: "B2", task: "4 manifest" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("no session nope; open one with session_open");
  });

  test("closes its session in its own repository", async () => {
    const { call, alpha, beta } = await serving();
    const inAlpha = await opened(call, tree(alpha, "data"));
    const inBeta = await opened(call, tree(beta, "data"));

    await call("session_close", { sessionId: inBeta });

    const left = async (repo: string): Promise<unknown[]> => (await call("session_list", { repo })).structured["sessions"] as unknown[];
    expect(await left("beta")).toHaveLength(0);
    expect((await left("alpha")).map((s) => (s as { id: string }).id)).toEqual([inAlpha]);
  });
});

describe("a read tool with no session of its own", () => {
  test("reads the repository it names", async () => {
    const { call, beta } = await serving();
    await opened(call, tree(beta, "engine"), "kiro");

    const { structured } = await call("session_list", { repo: "beta" });

    expect((structured["sessions"] as { agent: string }[]).map((s) => s.agent)).toEqual(["kiro"]);
  });

  test("reads its session's repository when given a session", async () => {
    const { call, beta } = await serving();
    const session = await opened(call, tree(beta, "engine"), "kiro");

    const { structured } = await call("session_list", { sessionId: session });

    expect((structured["sessions"] as { agent: string }[]).map((s) => s.agent)).toEqual(["kiro"]);
  });

  test("reads the default repository when it names none", async () => {
    const { call, alpha, beta } = await serving();
    await opened(call, tree(alpha, "data"), "in-alpha");
    await opened(call, tree(beta, "data"), "in-beta");

    const { structured } = await call("session_list");

    expect((structured["sessions"] as { agent: string }[]).map((s) => s.agent)).toEqual(["in-alpha"]);
  });

  test("is refused when its session and the repository it names disagree", async () => {
    const { call, alpha } = await serving();
    const session = await opened(call, tree(alpha, "data"));

    const refused = await call("ledger_check", { sessionId: session, repo: "beta" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(`session ${session} is in alpha, not beta`);
  });

  test("is refused for a repository that is not listed", async () => {
    const { call } = await serving();

    const refused = await call("context_pack", { level: "project", repo: "ghost" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("no repository 'ghost'; listed: alpha, beta");
  });

  test("gives each repository its own board", async () => {
    const { call, repos } = await serving();
    await new Records(await repos.get("beta")).update((ledger) => ({ ledger: { ...ledger, milestones: [] }, message: "emptied" }));

    const rowsOf = async (repo: string): Promise<unknown[]> => (await call("board_get", { repo })).structured["rows"] as unknown[];

    expect(await rowsOf("alpha")).not.toHaveLength(0);
    expect(await rowsOf("beta")).toHaveLength(0);
  });
});
