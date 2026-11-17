import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, test } from "vitest";
import { ANSWER_LIMIT } from "../src/decorators/sized.ts";
import { manyRepos, reading, type RepoSource } from "../src/source.ts";
import { ok } from "../src/respond.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked, type Tracked } from "../../core/tests/support/tracked.ts";
import { connect, type Call } from "./support/connect.ts";

const QUESTIONS = 15;
const DEFAULT_LINE = "read from alpha, the default repository; repo names another (repo_list lists them)";

interface Listing {
  call: Call;
  client: Client;
  alpha: Tracked;
  source: RepoSource;
}

async function listing(count: 1 | 2): Promise<Listing> {
  const home = await tmpDir("tally-home-");
  const alpha = await makeTracked();
  await addRepo(home, { root: alpha.root, name: "alpha" });
  if (count === 2) await addRepo(home, { root: (await makeTracked()).root, name: "beta" });
  const source = manyRepos(new Repos(home));
  const { call, client } = await connect(source);
  return { call, client, alpha, source };
}

async function textParts(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string[]> {
  const result = await client.callTool({ name, arguments: args });
  return (result.content as { type: string; text?: string }[]).map((part) => part.text ?? "");
}

const lastLine = (text: string): string => text.split("\n").at(-1) ?? "";

describe("a read that names neither a session nor a repository, with several listed", () => {
  test("answers JSON text as one JSON value that carries repo", async () => {
    const { client } = await listing(2);

    const tracks = await textParts(client, "track_list");
    const locks = await textParts(client, "lock_list");

    expect(tracks).toHaveLength(1);
    expect(JSON.parse(tracks[0] ?? "")).toMatchObject({ tracks: expect.any(Array), repo: "alpha" });
    expect(locks).toEqual([JSON.stringify({ locks: [], repo: "alpha" })]);
  });

  test("adds the sentence as a last part to an answer whose text the tool wrote itself", async () => {
    const { call, client } = await listing(2);

    const checked = await call("ledger_check");
    const parts = await textParts(client, "ledger_check");

    expect(checked.structured["repo"]).toBe("alpha");
    expect(lastLine(checked.text)).toBe(DEFAULT_LINE);
    expect(parts.at(-1)).toBe(DEFAULT_LINE);
    expect(parts[0]).not.toContain("\"repo\"");
  });

  test("is still cut to fit when it is large, and keeps repo", async () => {
    const { call, client, alpha } = await listing(2);
    const asking = (await call("session_open", { worktree: alpha.trees["data"]!, agent: "claude" })).structured["id"];
    for (let n = 0; n < QUESTIONS; n += 1) await call("question_add", { sessionId: asking, group: "g", question: `${n} ${"why ".repeat(490)}`, meanwhile: "wait" });

    const result = await client.callTool({ name: "question_list", arguments: {} });
    const parts = (result.content as { text?: string }[]).map((part) => part.text ?? "");

    expect(result.structuredContent).toMatchObject({ repo: "alpha", truncated: [expect.objectContaining({ path: "open" })] });
    expect(JSON.parse(parts[0] ?? "")).toMatchObject({ repo: "alpha", truncated: expect.any(Array) });
    expect(parts.join("\n").length).toBeLessThanOrEqual(ANSWER_LIMIT);
  });
});

describe("a read that answers as before", () => {
  test("when one repository is listed", async () => {
    const { call } = await listing(1);

    const tracks = await call("track_list");

    expect(tracks.structured["repo"]).toBeUndefined();
    expect(tracks.text).toBe(JSON.stringify(tracks.structured));
  });

  test("when it names the repository or a session", async () => {
    const { call, alpha } = await listing(2);
    const opened = await call("session_open", { worktree: alpha.trees["data"]!, agent: "claude" });

    const named = await call("track_list", { repo: "alpha" });
    const bySession = await call("track_list", { sessionId: opened.structured["id"] as string });

    expect(named.structured["repo"]).toBeUndefined();
    expect(named.text).toBe(JSON.stringify(named.structured));
    expect(bySession.structured["repo"]).toBeUndefined();
    expect(bySession.text.split("\n")[0]).toBe(JSON.stringify({ tracks: bySession.structured["tracks"] }));
  });

  test("when the answer already has a repo key of its own", async () => {
    const { source } = await listing(2);
    const own = ok({ repo: "its own", rows: [] });

    const result = await reading(source, {}, async () => own);

    expect(result).toEqual(own);
  });

  test("when it is refused", async () => {
    const { call } = await listing(2);

    const refused = await call("docs_read", { path: "nowhere.md" });

    expect(refused.isError).toBe(true);
    expect(refused.text).not.toContain("default repository");
  });
});
