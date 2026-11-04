import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createTallyServer } from "../src/server.ts";
import { busyLock } from "../../core/tests/support/busy.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { sh } from "../../core/tests/support/repo.ts";
import type { Config } from "../../core/src/schema/config.ts";
import { parseChecks } from "../../core/src/records/checks.ts";
import { addDecision, replaceDecision } from "../../core/src/records/decisions.ts";
import { answerQuestion } from "../../core/src/records/questions.ts";
import { CHECKS } from "../../core/tests/fixtures/records.ts";

interface Called {
  text: string;
  isError: boolean;
  structured: Record<string, unknown> | undefined;
}

async function connected(records?: Partial<Config["records"]>) {
  const tracked = await makeTracked(records);
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
    expect(names).toEqual(["board_get", "buildlog_append", "buildlog_render", "checks_fingerprint", "checks_get", "checks_set", "context_pack", "decision_list", "docs_list", "docs_read", "docs_search", "evidence_list", "evidence_record", "evidence_run", "handoff_read", "handoff_write", "land_run", "ledger_check", "lock_acquire", "lock_list", "lock_release", "milestone_add", "question_add", "question_list", "session_close", "session_list", "session_open", "task_claim", "task_land", "task_other", "task_plan", "task_release", "task_unwait", "task_wait", "views_claude"]);
    const refused = await call("task_claim", { sessionId: "nope", milestone: "B2", task: "4 manifest" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("no session nope; open one with session_open");
  });

  test("in batch mode the last session to close commits every record at once, and an earlier close commits nothing", async () => {
    const { call, trees, root } = await connected({ commit: true, batch: true });
    const count = async (): Promise<string> => sh(root, ["rev-list", "--count", "HEAD"]);
    const before = await count();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    const engine = (await call("session_open", { worktree: trees["engine"]!, track: "engine", agent: "b" })).structured!["id"] as string;
    await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 more"] });
    await call("handoff_write", { sessionId: engine, lines: ["a note"] });
    expect(await count()).toBe(before);

    await call("session_close", { sessionId: data });
    expect(await count()).toBe(before);
    const closed = await call("session_close", { sessionId: engine });

    expect(await count()).toBe(String(Number(before) + 1));
    expect(closed.structured!["recordsCommit"]).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toMatch(/^records: \d+ record files? up to [0-9a-f]{7}$/);
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });

  test("the last session's close still closes when the landing lock is busy, and the records wait on disk", async () => {
    const { call, trees, root } = await connected({ commit: true, batch: true });
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 more"] });
    busyLock("landing.lock");

    const closed = await call("session_close", { sessionId: data });

    expect(closed.isError).toBe(false);
    expect(closed.structured).toMatchObject({ session: { id: data }, recordsCommit: null });
    expect((await call("session_list")).structured).toEqual({ sessions: [] });
    expect(await sh(root, ["status", "--porcelain"])).toContain("docs/records/ledger.json");
  });

  test("a change already written is not failed by a landing lock it could not take", async () => {
    const { call, trees } = await connected({ commit: true });
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    busyLock("landing.lock");

    const planned = await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 more"] });
    const note = await call("handoff_write", { sessionId: data, lines: ["a note"] });

    expect(planned.isError).toBe(false);
    expect(planned.structured).toMatchObject({ message: "B2: planned 1 new task(s): 6 more", commit: null });
    expect(note.isError).toBe(false);
    expect((await call("handoff_read", { track: "data" })).structured).toMatchObject({ current: { lines: ["a note"] } });
  });

  test("evidence_run answers with what ran even when the record could not be written", async () => {
    const { call, trees } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    busyLock("B2.json");

    const ran = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "clippy", command: ["sh", "-c", "exit 101"] });

    expect(ran.isError).toBe(false);
    expect(ran.structured).toMatchObject({ recorded: false, record: { kind: "clippy", exit: 101 }, logPath: expect.stringContaining("clippy") });
    expect(ran.structured!["problem"]).toMatch(/nothing was changed/);
  });

  test("evidence_run and evidence_record say so when a red is not a red", async () => {
    const { call, trees } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;

    const ran = await call("evidence_run", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "red", command: ["sh", "-c", "exit 1"] });
    const kept = await call("evidence_record", { sessionId: data, milestone: "B2", task: "4 manifest", kind: "red", command: ["x"], cwd: ".", started: "", seconds: 0, exit: 0 });

    expect(ran.structured).toMatchObject({ record: { kind: "other" }, notice: expect.stringContaining("no failed test") });
    expect(kept.structured).toMatchObject({ record: { kind: "other" }, notice: "recorded as other, not red: it exited 0" });
  });

  test("land_run with a milestone and a task records them at the hash it made and frees the claim", async () => {
    const { call, trees, root } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    await call("task_claim", { sessionId: data, milestone: "B2", task: "4 manifest" });
    await mkdir(join(trees["data"]!, ".temp"), { recursive: true });
    await writeFile(join(trees["data"]!, ".temp", "m.txt"), "feat(data): a\n");
    await writeFile(join(trees["data"]!, "a.rs"), "a");

    const landed = await call("land_run", { sessionId: data, files: ["a.rs"], messageFile: ".temp/m.txt", milestone: "B2", task: "4 manifest" });

    const head = await sh(root, ["rev-parse", "--short=7", "HEAD"]);
    expect(landed.isError).toBe(false);
    expect(landed.structured).toMatchObject({ head, commits: [head], recording: { recorded: true, message: `B2 '4 manifest': landed at ${head}` } });
    expect((await call("task_claim", { sessionId: data, milestone: "B2", task: "5 transcoder" })).isError).toBe(false);
    expect((await call("ledger_check")).text).toBe("the ledger covers every commit on main");
  });

  test("land_run that cannot record says so with the commit and is no error, and half a target lands nothing", async () => {
    const { call, trees, root } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    await mkdir(join(trees["data"]!, ".temp"), { recursive: true });
    await writeFile(join(trees["data"]!, ".temp", "m.txt"), "feat(data): a\n");
    await writeFile(join(trees["data"]!, "a.rs"), "a");
    const before = await sh(root, ["rev-parse", "main"]);

    const half = await call("land_run", { sessionId: data, files: ["a.rs"], messageFile: ".temp/m.txt", milestone: "B2" });
    const moved = await sh(root, ["rev-parse", "main"]);
    const foreign = await call("land_run", { sessionId: data, files: ["a.rs"], messageFile: ".temp/m.txt", milestone: "B2", task: "T9 store" });

    expect(half.isError).toBe(true);
    expect(moved).toBe(before);
    expect(foreign.isError).toBe(false);
    const head = await sh(root, ["rev-parse", "--short=7", "HEAD"]);
    expect(foreign.structured).toMatchObject({ head, recording: { recorded: false, message: expect.stringContaining(`landed at ${head}`) } });
  });

  test("task_land frees the claim whoever holds it, since a landed task cannot be worked", async () => {
    const { call, trees, root } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    const operator = (await call("session_open", { worktree: root, track: "main", agent: "op" })).structured!["id"] as string;
    await call("task_claim", { sessionId: data, milestone: "B2", task: "4 manifest" });
    await writeFile(join(root, "src.rs"), "x");
    await sh(root, ["add", "src.rs"]);
    await sh(root, ["commit", "-q", "-m", "feat: work"]);
    const sha = await sh(root, ["rev-parse", "--short=7", "HEAD"]);

    const landed = await call("task_land", { sessionId: operator, milestone: "B2", task: "4 manifest", commit: sha });

    expect(landed.structured).toMatchObject({ message: `B2 '4 manifest': landed at ${sha}`, released: { task: "4 manifest", agent: "a" } });
    expect((await call("task_claim", { sessionId: data, milestone: "B2", task: "5 transcoder" })).isError).toBe(false);
  });

  test("task_land stays scoped to the session's track", async () => {
    const { call, trees, root } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    const sha = await sh(root, ["rev-parse", "--short=7", "HEAD"]);

    const foreign = await call("task_land", { sessionId: data, milestone: "B2", task: "T9 store", commit: sha });
    const unplanned = await call("task_land", { sessionId: data, milestone: "B2", task: "new", commit: sha, track: "engine" });

    expect(foreign.text).toMatch(/may not write track engine/);
    expect(unplanned.text).toMatch(/may not write track engine/);
  });

  test("question_list returns the open rows and a count, and the answered rows only when asked", async () => {
    const { call, repo, trees } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    await call("question_add", { sessionId: data, group: "engine", question: "first?", meanwhile: "wait" });
    await call("question_add", { sessionId: data, group: "engine", question: "second?", meanwhile: "wait" });
    await answerQuestion(repo, 1, "SIM-1");

    const open = await call("question_list");
    const all = await call("question_list", { answered: true });

    expect(open.structured).toMatchObject({ nextRow: 3, answeredCount: 1, open: [{ row: 2, question: "second?" }] });
    expect(open.structured).not.toHaveProperty("answered");
    expect(all.structured).toMatchObject({ answeredCount: 1, open: [{ row: 2 }], answered: [{ row: 1, decision: "SIM-1" }] });
  });

  test("question_list with no record yet is empty", async () => {
    const { call } = await connected();

    expect((await call("question_list")).structured).toEqual({ schema: 1, nextRow: 1, open: [], answeredCount: 0 });
  });

  test("decision_list narrows by group and by ids, its replaced rows with it", async () => {
    const { call, repo } = await connected();
    const decision = (id: string, group: string) => ({ id, group, text: `**${id}.**`, since: "the operator", status: "in force" });
    await addDecision(repo, decision("SIM-1", "engine"), { operator: true });
    await addDecision(repo, decision("SIM-2", "engine"), { operator: true });
    await addDecision(repo, decision("SRC-1", "data"), { operator: true });
    await replaceDecision(repo, { ...decision("SIM-2", "engine"), why: "widened" }, { operator: true });
    const ids = async (args: Record<string, unknown>): Promise<string[][]> => {
      const { decisions, replaced } = (await call("decision_list", args)).structured as { decisions: { id: string }[]; replaced: { id: string }[] };
      return [decisions.map((d) => d.id), replaced.map((r) => r.id)];
    };

    expect(await ids({})).toEqual([["SIM-1", "SIM-2", "SRC-1"], ["SIM-2"]]);
    expect(await ids({ group: "engine" })).toEqual([["SIM-1", "SIM-2"], ["SIM-2"]]);
    expect(await ids({ ids: ["SRC-1", "SIM-1"] })).toEqual([["SIM-1", "SRC-1"], []]);
    expect(await ids({ group: "data", ids: ["SIM-1"] })).toEqual([[], []]);
    expect(await ids({ ids: ["SIM-2"] })).toEqual([["SIM-2"], ["SIM-2"]]);
  });

  test("board_get with scope mine returns the session's rows and tasks, and all of them without it", async () => {
    const { call, trees } = await connected();
    const engine = (await call("session_open", { worktree: trees["engine"]!, track: "engine", agent: "e" })).structured!["id"] as string;
    const taskIds = (board: Called): string[] => (board.structured!["rows"] as { tasks: { id: string }[] }[]).flatMap((r) => r.tasks.map((t) => t.id));

    const mine = await call("board_get", { scope: "mine", sessionId: engine });
    const all = await call("board_get");

    expect(taskIds(mine)).toEqual(["T9 store"]);
    expect(taskIds(all)).toEqual(["4 manifest", "5 transcoder", "T9 store", "done"]);
  });

  test("task_unwait clears a wait of the session's track and refuses another track's", async () => {
    const { call, trees } = await connected();
    const data = (await call("session_open", { worktree: trees["data"]!, track: "data", agent: "a" })).structured!["id"] as string;
    const engine = (await call("session_open", { worktree: trees["engine"]!, track: "engine", agent: "e" })).structured!["id"] as string;

    const foreign = await call("task_unwait", { sessionId: data, milestone: "B2", task: "T9 store" });
    const cleared = await call("task_unwait", { sessionId: engine, milestone: "B2", task: "T9 store" });
    const board = await call("board_get", { scope: "mine", sessionId: engine });

    expect(foreign.text).toMatch(/may not write track engine/);
    expect(cleared.structured).toMatchObject({ message: "B2 'T9 store': no longer waits for B2" });
    expect((board.structured!["rows"] as { notes: string[] }[])[0]?.notes).toEqual(["engine next: T9 store"]);
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
    expect((await call("decision_list", { group: "engine" })).structured).toEqual({ decisions: [], replaced: [] });
  });
});
