import { describe, expect, test } from "vitest";
import { manyRepos, reading, type RepoSource } from "../src/source.ts";
import { ok } from "../src/respond.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked, type Tracked } from "../../core/tests/support/tracked.ts";
import { connect, type Call } from "./support/connect.ts";

const DEFAULT_LINE = "read from alpha, the default repository; repo names another (repo_list lists them)";

async function listing(count: 1 | 2): Promise<{ call: Call; alpha: Tracked; source: RepoSource }> {
  const home = await tmpDir("tally-home-");
  const alpha = await makeTracked();
  await addRepo(home, { root: alpha.root, name: "alpha" });
  if (count === 2) await addRepo(home, { root: (await makeTracked()).root, name: "beta" });
  const source = manyRepos(new Repos(home));
  const { call } = await connect(source);
  return { call, alpha, source };
}

const lastLine = (text: string): string => text.split("\n").at(-1) ?? "";

describe("a read that names neither a session nor a repository", () => {
  test("says which repository it read when more than one is listed", async () => {
    const { call } = await listing(2);

    const tracks = await call("track_list");
    const locks = await call("lock_list");

    expect(tracks.structured["repo"]).toBe("alpha");
    expect(lastLine(tracks.text)).toBe(DEFAULT_LINE);
    expect(locks.structured).toMatchObject({ repo: "alpha", locks: [] });
    expect(lastLine(locks.text)).toBe(DEFAULT_LINE);
  });

  test("answers as before when one repository is listed", async () => {
    const { call } = await listing(1);

    const tracks = await call("track_list");

    expect(tracks.structured["repo"]).toBeUndefined();
    expect(tracks.text).toBe(JSON.stringify(tracks.structured));
  });

  test("answers as before when it names the repository or a session", async () => {
    const { call, alpha } = await listing(2);
    const opened = await call("session_open", { worktree: alpha.trees["data"]!, agent: "claude" });

    const named = await call("track_list", { repo: "alpha" });
    const bySession = await call("track_list", { sessionId: opened.structured["id"] as string });

    expect(named.structured["repo"]).toBeUndefined();
    expect(named.text).toBe(JSON.stringify(named.structured));
    expect(bySession.structured["repo"]).toBeUndefined();
    expect(bySession.text.split("\n")[0]).toBe(JSON.stringify({ tracks: bySession.structured["tracks"] }));
  });

  test("keeps a repo key the answer already has, and still says which repository it read", async () => {
    const { source } = await listing(2);

    const result = await reading(source, {}, async () => ok({ repo: "its own", rows: [] }));

    expect(result.structuredContent).toEqual({ repo: "its own", rows: [] });
    expect(result.content.map((part) => (part.type === "text" ? part.text : ""))).toEqual([JSON.stringify({ repo: "its own", rows: [] }), DEFAULT_LINE]);
  });

  test("leaves a refusal as it was", async () => {
    const { call } = await listing(2);

    const refused = await call("docs_read", { path: "nowhere.md" });

    expect(refused.isError).toBe(true);
    expect(refused.text).not.toContain("default repository");
  });
});
