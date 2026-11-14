import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openRepo } from "../../core/src/index.ts";
import { landedIn, milestoneIn, queued } from "../../core/tests/support/phased.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

const PHASE = { commit: true, batch: true, commitAt: "phase" as const };
const G = { id: "G", name: "exports", goal: "Ship exports.", weight: 3 };

async function serving(records: Record<string, unknown> = PHASE) {
  const tracked = await makeTracked(records);
  const configPath = join(tracked.root, "docs/records/config.json");
  await writeFile(configPath, JSON.stringify({ ...JSON.parse(await readFile(configPath, "utf8")), context: "records" }));
  await sh(tracked.root, ["add", "-A", "docs/records"]);
  await sh(tracked.root, ["commit", "-q", "--allow-empty", "-m", "records: settle"]);
  const repo = await openRepo(tracked.root);
  const { call, client } = await connect(repo);
  return { ...tracked, repo, call, client, operator: await opened(call, tracked.root, "operator"), data: await opened(call, tracked.trees["data"]!, "claude") };
}

describe("phase_add", () => {
  test("adds a phase and answers it", async () => {
    const { call, operator } = await serving();

    const added = await call("phase_add", { sessionId: operator, ...G, decision: "DEC-12" });

    expect(added.isError).toBe(false);
    expect(added.structured["phase"]).toMatchObject({ id: "G", name: "exports", goal: "Ship exports.", weight: 3, decision: "DEC-12" });
    expect(added.structured["commit"]).toBeNull();
  });

  test("is usable by milestone_add at once, and is refused with the phases named when the id exists", async () => {
    const { call, operator } = await serving();
    await call("phase_add", { sessionId: operator, ...G });

    const milestone = await call("milestone_add", { sessionId: operator, id: "G1", stage: "G", name: "csv", track: "data", weight: 1 });
    const again = await call("phase_add", { sessionId: operator, ...G });

    expect(milestone.isError).toBe(false);
    expect(again).toMatchObject({ isError: true, text: "phase G exists; the phases are B and G" });
  });

  test("is refused to a track session with what to do instead, and refuses an argument it does not have", async () => {
    const { call, operator, data } = await serving();

    expect(await call("phase_add", { sessionId: data, ...G })).toMatchObject({ isError: true, text: "only an operator session adds a phase; a track that wants one asks a question with question_add" });
    const mistyped = await call("phase_add", { sessionId: operator, ...G, colour: "red" });
    expect(mistyped.isError).toBe(true);
    expect(mistyped.text).toContain("colour");
  });
});

describe("phase_list", () => {
  test("answers each phase with its state, tasks and what still stops it, to a call with no session", async () => {
    const { call, operator, repo } = await serving();
    await call("phase_add", { sessionId: operator, ...G });
    await milestoneIn(repo, "G", "G1", "data", ["1 csv"]);

    const listed = await call("phase_list");
    const open = await call("phase_list", { state: "open" });
    const closed = await call("phase_list", { state: "closed" });

    const phases = listed.structured["phases"] as { id: string; state: string; tasks: unknown; left: string[] }[];
    expect(phases.map((phase) => phase.id)).toEqual(["B", "G"]);
    expect(phases[1]).toMatchObject({ state: "open", tasks: { total: 1, landed: 0 } });
    expect(phases[1]?.left[0]).toContain("1 of its tasks is not landed (G1 / 1 csv)");
    expect((open.structured["phases"] as unknown[]).length).toBe(2);
    expect(closed.structured["phases"]).toEqual([]);
  });

  test("refuses an argument it does not have, and a state that is not open or closed", async () => {
    const { call } = await serving();

    expect((await call("phase_list", { states: "open" })).isError).toBe(true);
    expect((await call("phase_list", { state: "done" })).isError).toBe(true);
  });
});

describe("phase_close", () => {
  async function ready() {
    const made = await serving();
    await made.call("phase_add", { sessionId: made.operator, ...G });
    await milestoneIn(made.repo, "G", "G1", "data", ["1 csv"]);
    await landedIn(made.repo, "G1");
    return made;
  }

  test("closes a phase and answers its milestones, tasks, tracks, what has no build log and the commit", async () => {
    const { call, operator, root } = await ready();

    const closed = await call("phase_close", { sessionId: operator, phase: "G", summary: "both formats ship" });

    expect(closed.isError).toBe(false);
    expect(closed.structured).toMatchObject({ milestones: ["G1"], tasks: { total: 1, landed: 1 }, tracksClosed: [], tracksLeft: [], withoutBuildLog: ["G1"] });
    expect(closed.structured["phase"]).toMatchObject({ id: "G", summary: "both formats ship" });
    expect(closed.structured["commit"]).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toMatch(/^records: phase G closed, \d+ record files$/);
  });

  test("refuses with what to do next, and a closed phase takes no new milestone or task", async () => {
    const { call, operator, data, repo } = await ready();
    await milestoneIn(repo, "G", "G2", "data", ["1 json"]);
    const ticket = await queued(repo, "engine");

    const notLanded = await call("phase_close", { sessionId: operator, phase: "G", summary: "s" });
    await landedIn(repo, "G2");
    const trackSession = await call("phase_close", { sessionId: data, phase: "G", summary: "s" });
    await call("phase_close", { sessionId: operator, phase: "G", summary: "s" });
    const milestone = await call("milestone_add", { sessionId: operator, id: "G3", stage: "G", name: "xml", track: "data", weight: 1 });
    const task = await call("task_plan", { sessionId: operator, milestone: "G1", track: "data", tasks: ["2 more"] });
    const again = await call("phase_close", { sessionId: operator, phase: "G", summary: "s" });

    expect(notLanded.text).toMatch(/^phase G cannot close: 1 of its tasks is not landed \(G2 \/ 1 json\); land them, or remove a planned one with task_remove/);
    expect(trackSession.text).toBe("only an operator session closes a phase; a track that wants one closed asks a question with question_add");
    expect(milestone).toMatchObject({ isError: true, text: "phase G is closed; later work goes in a new phase (phase_add)" });
    expect(task).toMatchObject({ isError: true, text: "phase G is closed; later work goes in a new phase (phase_add)" });
    expect(again.text).toMatch(/^phase G was closed on \S+ by operator; later work goes in a new phase \(phase_add\)$/);
    expect(ticket).toBe("t-engine");
  });

  test("leaves nothing waiting behind it, since neither it nor records_commit writes an activity event after its commit", async () => {
    const { call, operator, root } = await ready();

    await call("phase_close", { sessionId: operator, phase: "G", summary: "both formats ship" });

    expect(await sh(root, ["status", "--porcelain", "-uall"])).toBe("");
    const events = (await call("activity_get", { sessionId: operator })).structured["events"] as { verb: string }[];
    expect(events.map((event) => event.verb)).not.toContain("phase_close");
    expect(events.map((event) => event.verb)).toContain("phase_add");
  });

  test("refuses an argument it does not have", async () => {
    const { call, operator } = await ready();

    expect((await call("phase_close", { sessionId: operator, phase: "G", summary: "s", force: true })).text).toContain("force");
  });
});

describe("records_commit", () => {
  test("commits what waits and answers the commit and the number of files, and nothing when nothing waits", async () => {
    const { call, operator, root } = await serving();
    await call("phase_add", { sessionId: operator, ...G });

    const done = await call("records_commit", { sessionId: operator, why: "before the push" });
    const nothing = await call("records_commit", { sessionId: operator, why: "again" });

    expect(done.structured["commit"]).toMatch(/^[0-9a-f]{7}$/);
    expect(done.structured["files"]).toBeGreaterThan(0);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toMatch(/^records: \d+ record files?, before the push$/);
    expect(nothing.isError).toBe(false);
    expect(nothing.structured).toMatchObject({ commit: null, files: 0 });
  });

  test("is refused to a track session, and where tally's commits are off, with what to do instead", async () => {
    const made = await serving();
    const off = await serving({ commit: false });

    expect((await made.call("records_commit", { sessionId: made.data, why: "x" })).text).toContain("only an operator session commits the waiting records");
    expect((await off.call("records_commit", { sessionId: off.operator, why: "x" })).text).toBe("this repository turned tally's records commits off (records.commit is false); commit docs/records/ yourself, or turn them on with repo_configure");
    expect((await made.call("records_commit", { sessionId: made.operator, why: "x", note: "y" })).text).toContain("note");
  });
});

describe("what waits, and the board", () => {
  test("ledger_check answers recordsWaiting", async () => {
    const { call, operator } = await serving();
    await call("phase_add", { sessionId: operator, ...G });

    const checked = await call("ledger_check");

    expect((checked.structured["recordsWaiting"] as { files: number }).files).toBeGreaterThan(0);
    expect(checked.structured["recordsWaiting"]).toHaveProperty("since");
  });

  test("an operator's brief answers recordsWaiting, and a track's brief does not", async () => {
    const tracked = await makeTracked(PHASE);
    const { call } = await connect(keepingContextAsRecords(tracked.repo));

    const operator = await call("session_open", { worktree: tracked.root, agent: "operator" });
    const track = await call("session_open", { worktree: tracked.trees["data"]!, agent: "claude" });

    expect((operator.structured["brief"] as { recordsWaiting: { files: number } }).recordsWaiting.files).toBeGreaterThan(0);
    expect(track.structured["brief"]).not.toHaveProperty("recordsWaiting");
  });

  test("an operator's brief answers what is uncommitted in its checkout, the records left out, and a track's brief does not", async () => {
    const tracked = await makeTracked(PHASE);
    await writeFile(join(tracked.root, "plan.md"), "draft\n");
    const { call } = await connect(keepingContextAsRecords(tracked.repo));

    const operator = await call("session_open", { worktree: tracked.root, agent: "operator" });
    const track = await call("session_open", { worktree: tracked.trees["data"]!, agent: "claude" });

    expect((operator.structured["brief"] as { checkout: unknown }).checkout).toStrictEqual({ branch: "main", changed: ["plan.md"], total: 1 });
    expect(track.structured["brief"]).not.toHaveProperty("checkout");
  });

  test("board_get carries each phase's goal and state", async () => {
    const { call, operator } = await serving();
    await call("phase_add", { sessionId: operator, ...G });

    const board = await call("board_get");

    expect(board.structured["stages"]).toEqual([{ id: "B", name: "widen", state: "open" }, { id: "G", name: "exports", goal: "Ship exports.", state: "open" }]);
  });

  test("each new tool says what it does in under 700 characters, with a title and every argument described", async () => {
    const { client } = await serving();
    const tools = (await client.listTools()).tools;

    for (const name of ["phase_add", "phase_list", "phase_close", "records_commit"]) {
      const tool = tools.find((one) => one.name === name);
      expect(tool?.title, name).toBeTruthy();
      expect((tool?.description ?? "").length, name).toBeGreaterThan(40);
      expect((tool?.description ?? "").length, name).toBeLessThan(700);
    }
  });
});
