import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createTallyServer } from "../src/server.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { parseChecks } from "../../core/src/records/checks.ts";
import { CHECKS } from "../../core/tests/fixtures/records.ts";

interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown> | undefined;
}

async function connected() {
  const tracked = await makeTracked();
  const server = createTallyServer(tracked.repo);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Called> => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    return { text: content.map((c) => c.text ?? "").join("\n"), isError: result.isError === true, structured: result.structuredContent as Record<string, unknown> | undefined };
  };
  return { ...tracked, client, call };
}

describe("the tally MCP server", () => {
  test("lists its tools and refuses writes without a session", async () => {
    const { client, call } = await connected();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["board_get", "buildlog_append", "buildlog_render", "checks_fingerprint", "checks_get", "checks_set", "context_pack", "docs_list", "docs_read", "docs_search", "evidence_list", "evidence_record", "evidence_run", "handoff_read", "handoff_write", "land_run", "ledger_check", "lock_acquire", "lock_list", "lock_release", "milestone_add", "question_add", "question_list", "session_close", "session_list", "session_open", "task_claim", "task_land", "task_other", "task_plan", "task_release", "task_wait", "views_claude"]);
    const refused = await call("task_claim", { sessionId: "nope", milestone: "B2", task: "4 manifest" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("no session nope; open one with session_open");
  });

  test("a session opens on its worktree, claims within its track, holds a lock, and closing releases both", async () => {
    const { call, trees } = await connected();
    const bad = await call("session_open", { worktree: trees["data"]!, track: "engine", agent: "claude" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/is not the worktree of track engine/);
    const opened = await call("session_open", { worktree: trees["data"]!, track: "data", agent: "claude" });
    expect(opened.isError).toBe(false);
    const sessionId = opened.structured!["id"] as string;
    const claimed = await call("task_claim", { sessionId, milestone: "B2", task: "4 manifest" });
    expect(claimed.structured).toMatchObject({ task: "4 manifest", agent: "claude" });
    const foreign = await call("task_claim", { sessionId, milestone: "B2", task: "T9 store" });
    expect(foreign.text).toMatch(/may not write track engine/);
    expect((await call("lock_acquire", { sessionId, name: "evidence", note: "measuring" })).structured).toMatchObject({ name: "evidence" });
    const mine = await call("board_get", { scope: "mine", sessionId });
    expect((mine.structured!["claims"] as unknown[]).length).toBe(1);
    expect((mine.structured!["tracks"] as { track: string }[]).map((t) => t.track)).toEqual(["main", "data"]);
    const closed = await call("session_close", { sessionId });
    expect(closed.structured).toMatchObject({ releasedClaims: [{ task: "4 manifest" }], releasedLocks: [{ name: "evidence" }] });
    expect((await call("lock_list")).structured).toEqual({ locks: [] });
  });

  test("the ledger verbs record and commit, and the check reads main", async () => {
    const { call, root, trees } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    const planned = await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 transcoder", "B2 data close"] });
    expect(planned.structured).toMatchObject({ message: "B2: planned 2 new task(s): 6 transcoder, B2 data close", commit: null });
    const outside = await call("task_plan", { sessionId: data, milestone: "B2", track: "engine", tasks: ["x"] });
    expect(outside.text).toMatch(/may not write track engine/);
    await writeFile(join(root, "src.rs"), "x");
    await sh(root, ["add", "src.rs"]);
    await sh(root, ["commit", "-q", "-m", "feat: work"]);
    const sha = await sh(root, ["rev-parse", "--short=7", "HEAD"]);
    const check = await call("ledger_check");
    expect(check.text).toContain("feat: work");
    const landed = await call("task_land", { sessionId: data, milestone: "B2", task: "6 transcoder", commit: sha });
    expect(landed.structured).toMatchObject({ message: `B2 '6 transcoder': landed at ${sha}` });
    expect((await call("ledger_check")).text).toBe("the ledger covers every commit on main");
    const waited = await call("task_wait", { sessionId: data, milestone: "B2", task: "T9 store", what: "x" });
    expect(waited.text).toMatch(/may not write track engine/);
    const operator = (await call("session_open", { worktree: root, track: "main", agent: "op" })).structured!["id"] as string;
    expect((await call("milestone_add", { sessionId: data, id: "B3", stage: "B", name: "x", track: "data", weight: 1 })).text).toBe("only an operator session adds milestones");
    expect((await call("milestone_add", { sessionId: operator, id: "B3", stage: "B", name: "x", track: "data", weight: 1 })).structured).toMatchObject({ message: "B3: added to stage B" });
  });

  test("evidence, hand-offs, docs and context packs answer through the tools", async () => {
    const { call, trees } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    const ran = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "green", command: ["sh", "-c", "echo 'test result: ok. 3 passed; 0 failed; 0 ignored'"] });
    expect(ran.structured).toMatchObject({ record: { kind: "green", exit: 0, summary: { passed: 3 } } });
    expect(((await call("evidence_list", { milestone: "B2", task: "4 manifest" })).structured!["records"] as unknown[]).length).toBe(1);
    const note = await call("handoff_write", { sessionId: data, task: "4 manifest", lines: ["RED is in", "next: publication"] });
    expect(note.structured).toMatchObject({ handoff: { current: { lines: ["RED is in", "next: publication"] } } });
    expect((await call("handoff_read", { track: "data" })).structured).toMatchObject({ current: { from: "a" } });
    expect((await call("docs_read", { path: "RULES.md" })).text).toContain("Keep it simple");
    expect((await call("docs_read", { path: "../etc/passwd" })).isError).toBe(true);
    expect(((await call("docs_search", { query: "simple" })).structured!["hits"] as unknown[]).length).toBe(1);
    const pack = await call("context_pack", { level: "task", milestone: "B2", task: "4 manifest" });
    expect(pack.text).toContain("# B2 / 4 manifest (track data)");
    expect(pack.text).toContain("- green exit 0");
    expect(pack.text).toContain("next: publication");
  });

  test("checks and build logs answer through the tools, and set is guarded by main's fingerprint", async () => {
    const { call, root, trees } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    expect((await call("checks_get")).text).toBe("no checks.json yet; import one with tally import checks");
    const record = parseChecks(CHECKS);
    const refused = await call("checks_set", { sessionId: data, record });
    expect(refused.text).toMatch(/is not what git log prints for the config's paths at main/);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.rs"), "a");
    await sh(root, ["add", "src/a.rs"]);
    await sh(root, ["commit", "-q", "-m", "feat: a"]);
    const atMain = await sh(root, ["rev-parse", "--short=7", "HEAD"]);
    expect((await call("checks_set", { sessionId: data, record: { ...record, fingerprint: atMain } })).structured).toMatchObject({ fingerprint: atMain });
    expect((await call("checks_fingerprint")).structured).toEqual({ record: atMain, main: atMain, stands: true });
    expect(((await call("checks_get")).structured!["modules"] as unknown[]).length).toBe(2);
    const appended = await call("buildlog_append", { sessionId: data, group: "data", milestone: "B2", title: "The store", date: "2026-11-05", markdown: "Built." });
    expect(appended.structured).toMatchObject({ entry: { milestone: "B2", markdown: "Built." } });
    expect((await call("buildlog_render", { group: "data" })).text).toBe("# data: build log\n\n## B2. The store, 2026-11-05\n\nBuilt.\n");
    expect((await call("buildlog_append", { sessionId: data, group: "data", milestone: "B2", title: "x", date: "2026-11-05", markdown: "x" })).text).toBe("data's build log already has a section for B2");
    await writeFile(join(root, "CLAUDE.md"), "# C\n\n<!-- tally:standing -->\nold\n<!-- /tally:standing -->\n");
    const peek = await call("views_claude", { sessionId: data });
    expect(peek.structured).toMatchObject({ changed: true });
    expect(peek.text).toContain("| B | B2 store | data+engine |");
    expect((await call("views_claude", { sessionId: data, write: true })).text).toBe("only an operator session writes CLAUDE.md");
    const operator = (await call("session_open", { worktree: root, track: "main", agent: "op" })).structured!["id"] as string;
    expect((await call("views_claude", { sessionId: operator, write: true })).structured).toMatchObject({ changed: true });
    expect((await call("views_claude", { sessionId: operator })).structured).toMatchObject({ changed: false });
  });
});
