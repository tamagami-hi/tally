import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stateDirOf } from "../../src/repos/home.ts";
import { addRepo, removeRepo } from "../../src/repos/list.ts";
import { Repos } from "../../src/repos/repos.ts";
import { statePath } from "../../src/land/paths.ts";
import { assertMayWrite, getSession, listSessions, openSession } from "../../src/state/sessions.ts";
import { openRepo } from "../../src/store/records.ts";
import { tmpDir } from "../support/tmp.ts";
import { makeTracked, type Tracked } from "../support/tracked.ts";

const configPath = (root: string): string => join(root, "docs/records/config.json");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function rewriteConfig(root: string, change: (config: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const config = JSON.parse(await readFile(configPath(root), "utf8")) as Record<string, unknown>;
  await writeFile(configPath(root), `${JSON.stringify(change(config), null, 2)}\n`);
}

async function listed(names: readonly string[]): Promise<{ home: string; repos: Repos; tracked: Tracked[] }> {
  const home = await tmpDir("tally-home-");
  const tracked: Tracked[] = [];
  for (const name of names) {
    const made = await makeTracked();
    await addRepo(home, { root: made.root, name });
    tracked.push(made);
  }
  return { home, repos: new Repos(home), tracked };
}

const first = <T>(items: readonly T[]): T => {
  const [item] = items;
  if (item === undefined) throw new Error("the fixture made nothing");
  return item;
};

describe("where a repository's state lives", () => {
  test("is under the repository when it is opened by its root", async () => {
    const { root } = await makeTracked();

    const repo = await openRepo(root);

    expect(repo.stateDir).toBe(join(root, ".temp/tally/state"));
    expect(statePath(repo, "sessions.json")).toBe(join(root, ".temp/tally/state/sessions.json"));
  });

  test("is under the home folder when it is listed", async () => {
    const { home, repos, tracked } = await listed(["alpha"]);
    const { root, trees } = first(tracked);

    const repo = await repos.get("alpha");
    await openSession(repo, { worktree: trees["data"] ?? "", track: "data", agent: "claude" });

    expect(repo.name).toBe("alpha");
    expect(repo.stateDir).toBe(stateDirOf(home, "alpha"));
    expect(await exists(join(home, "state/alpha/sessions.json"))).toBe(true);
    expect(await exists(join(root, ".temp/tally/state/sessions.json"))).toBe(false);
  });
});

describe("two repositories at once", () => {
  test("each keeps its own sessions", async () => {
    const { repos, tracked } = await listed(["alpha", "beta"]);
    const [one, two] = tracked;
    const alpha = await repos.get("alpha");
    const beta = await repos.get("beta");

    const inAlpha = await openSession(alpha, { worktree: one?.trees["data"] ?? "", track: "data", agent: "claude" });
    const inBeta = await openSession(beta, { worktree: two?.trees["engine"] ?? "", track: "engine", agent: "kiro" });

    expect((await listSessions(alpha)).map((s) => s.id)).toEqual([inAlpha.id]);
    expect((await listSessions(beta)).map((s) => s.id)).toEqual([inBeta.id]);
  });

  test("a session is found in the repository it was opened in", async () => {
    const { repos, tracked } = await listed(["alpha", "beta"]);
    const beta = await repos.get("beta");
    const session = await openSession(beta, { worktree: tracked[1]?.trees["data"] ?? "", track: "data", agent: "claude" });

    const found = await repos.ofSession(session.id);

    expect(found.repo.name).toBe("beta");
    expect(found.session.id).toBe(session.id);
  });

  test("a session of one repository is unknown to the other", async () => {
    const { repos, tracked } = await listed(["alpha", "beta"]);
    const alpha = await repos.get("alpha");
    const beta = await repos.get("beta");
    const session = await openSession(alpha, { worktree: tracked[0]?.trees["data"] ?? "", track: "data", agent: "claude" });

    await expect(getSession(beta, session.id)).rejects.toThrow(`no session ${session.id}`);
    expect(() => assertMayWrite(alpha, session, "engine")).toThrow("may not write track engine's records");
  });

  test("a session id nobody opened is refused", async () => {
    const { repos } = await listed(["alpha"]);

    await expect(repos.ofSession("no-such-id")).rejects.toThrow("no session no-such-id; open one with session_open");
  });

  test("a worktree leads to its own repository", async () => {
    const { repos, tracked } = await listed(["alpha", "beta"]);

    expect((await repos.forPath(tracked[1]?.trees["engine"] ?? "")).name).toBe("beta");
  });
});

describe("the list as it changes", () => {
  test("a repository added later is served without a new Repos", async () => {
    const { home, repos } = await listed(["alpha"]);
    expect((await repos.entries()).map((entry) => entry.name)).toEqual(["alpha"]);
    const later = await makeTracked();

    await addRepo(home, { root: later.root, name: "beta" });

    expect((await repos.entries()).map((entry) => entry.name)).toEqual(["alpha", "beta"]);
    expect((await repos.get("beta")).root).toBe(later.root);
  });

  test("a repository removed from the list is no longer served", async () => {
    const { home, repos } = await listed(["alpha", "beta"]);
    await repos.get("beta");

    await removeRepo(home, "beta");

    await expect(repos.get("beta")).rejects.toThrow("no repository 'beta'; listed: alpha");
  });

  test("the default repository is the first one added", async () => {
    const { repos, tracked } = await listed(["alpha", "beta"]);

    expect((await repos.default()).root).toBe(first(tracked).root);
  });

  test("an empty list has no default", async () => {
    const repos = new Repos(await tmpDir("tally-home-"));

    await expect(repos.default()).rejects.toThrow("no repository is listed yet; add one in the sidebar");
  });
});

describe("a config as it changes", () => {
  test("a track added to config.json is seen without a new Repos", async () => {
    const { repos, tracked } = await listed(["alpha"]);
    const { root } = first(tracked);
    expect((await repos.get("alpha")).config.tracks.map((t) => t.name)).toEqual(["data", "engine"]);

    await rewriteConfig(root, (config) => ({ ...config, tracks: [...(config["tracks"] as unknown[]), { name: "product", worktree: ".temp/worktrees/product", branch: "track/product" }] }));

    expect((await repos.get("alpha")).config.tracks.map((t) => t.name)).toEqual(["data", "engine", "product"]);
  });

  test("an unchanged config is not read again", async () => {
    const { repos } = await listed(["alpha"]);

    expect(await repos.get("alpha")).toBe(await repos.get("alpha"));
  });

  test("a config that breaks keeps the last good one, and its error is shown", async () => {
    const { repos, tracked } = await listed(["alpha"]);
    const { root } = first(tracked);
    await repos.get("alpha");

    await writeFile(configPath(root), "{ not json");

    expect((await repos.get("alpha")).config.tracks.map((t) => t.name)).toEqual(["data", "engine"]);
    expect(repos.problem("alpha")).toContain("is not valid JSON");
  });

  test("the error clears when the config is mended", async () => {
    const { repos, tracked } = await listed(["alpha"]);
    const { root } = first(tracked);
    const good = await readFile(configPath(root), "utf8");
    await repos.get("alpha");
    await writeFile(configPath(root), "{ not json");
    await repos.get("alpha");

    await writeFile(configPath(root), `${good}\n`);

    expect((await repos.get("alpha")).config.name).toBe("Test");
    expect(repos.problem("alpha")).toBeUndefined();
  });

  test("a config that is broken from the start is refused", async () => {
    const { repos, tracked } = await listed(["alpha"]);
    await writeFile(configPath(first(tracked).root), "{ not json");

    await expect(repos.get("alpha")).rejects.toThrow("is not valid JSON");
  });
});
