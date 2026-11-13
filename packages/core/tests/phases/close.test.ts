import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { flushWhenFree } from "../../src/records/commit.ts";
import { commitWaitingRecords } from "../../src/records/waiting.ts";
import { appendBuildlog } from "../../src/records/buildlog.ts";
import { listNotes } from "../../src/records/notes.ts";
import { queueFile } from "../../src/land/queue.ts";
import { addPhase } from "../../src/phases/add.ts";
import { closePhase } from "../../src/phases/close.ts";
import { readPhases } from "../../src/phases/file.ts";
import { openSession } from "../../src/state/sessions.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { DATA, OPERATOR } from "../support/context.ts";
import { commitOn } from "../support/landing.ts";
import { landedIn, milestoneIn, phased, queued } from "../support/phased.ts";
import { isThere } from "../support/helped.ts";
import { sh } from "../support/repo.ts";

const OPENED = new Date("2026-11-14T09:00:00.000Z");
const NOW = new Date("2026-11-14T12:00:00.000Z");

async function ready(records?: Parameters<typeof phased>[0]) {
  const made = await phased(records);
  await addPhase(made.repo, OPERATOR, { id: "G", name: "exports", goal: "Ship exports.", weight: 3 }, OPENED);
  const repo = await made.fresh();
  await milestoneIn(repo, "G", "G1", "data", ["1 csv", "2 json"]);
  await landedIn(repo, "G1");
  return { ...made, repo };
}

describe("closing a phase", () => {
  test("refuses an unknown phase, and one that is closed already", async () => {
    const { repo } = await ready();

    await expect(closePhase(repo, OPERATOR, { phase: "X", summary: "s" }, NOW)).rejects.toThrow("no phase X; the phases are B and G");
    await closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW);
    await expect(closePhase(repo, OPERATOR, { phase: "G", summary: "again" }, NOW)).rejects.toThrow(`phase G was closed on ${NOW.toISOString()} by operator; later work goes in a new phase (phase_add)`);
  });

  test("is for an operator session, and needs a summary within 500 characters", async () => {
    const { repo } = await ready();

    await expect(closePhase(repo, DATA, { phase: "G", summary: "s" }, NOW)).rejects.toThrow("only an operator session closes a phase; a track that wants one closed asks a question with question_add");
    await expect(closePhase(repo, OPERATOR, { phase: "G", summary: "  " }, NOW)).rejects.toThrow("closing a phase needs a summary");
    await expect(closePhase(repo, OPERATOR, { phase: "G", summary: "s".repeat(501) }, NOW)).rejects.toThrow("the summary holds at most 500 characters; this one has 501");
  });

  test("refuses while a task of the phase is not landed, naming up to ten, and writes nothing", async () => {
    const { repo, root } = await ready();
    await milestoneIn(repo, "G", "G2", "data", Array.from({ length: 12 }, (_, index) => `t${index + 1}`));

    await expect(closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW)).rejects.toThrow(/^phase G cannot close: 12 of its tasks are not landed \(G2 \/ t1, G2 \/ t2, .* and 2 more\); land them, or remove a planned one with task_remove/);
    expect(await sh(root, ["status", "--porcelain", "-uall"])).not.toContain("closedAt");
    expect((await readPhases(repo.recordsDir)).phases.some((phase) => phase.closedAt !== undefined)).toBe(false);
  });

  test("refuses while main holds a commit the ledger does not record", async () => {
    const { repo, root } = await ready();
    await commitOn(root, "src/x.rs", "feat: x");
    const hash = await sh(root, ["rev-parse", "--short=7", "HEAD"]);

    await expect(closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW)).rejects.toThrow(`phase G cannot close: main has 1 commit the ledger does not record (${hash}); record each with task_land or task_other`);
  });

  test("refuses while a landing for one of its tracks is in the queue", async () => {
    const { repo } = await ready();
    const ticket = await queued(repo, "data");

    await expect(closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW)).rejects.toThrow(`phase G cannot close: track data has a landing in the queue (ticket ${ticket}); wait for it with land_wait, or cancel it with land_cancel`);
  });

  test("closes cleanly with exactly one commit that holds every waiting record file, and the summary as its body", async () => {
    const { repo, root, count } = await ready();
    const before = await count();

    const closed = await closePhase(repo, OPERATOR, { phase: "G", summary: "both formats ship" }, NOW);

    expect(await count()).toBe(before + 1);
    expect(closed.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toMatch(/^records: phase G closed, \d+ record files$/);
    expect(await sh(root, ["log", "-1", "--format=%b"])).toBe("both formats ship");
    expect(await sh(root, ["status", "--porcelain", "-uall"])).toBe("");
    expect(await sh(root, ["show", "--stat", "--format=", "HEAD"])).toContain("docs/records/phases.json");
    expect(closed.phase).toMatchObject({ id: "G", closedAt: NOW.toISOString(), closedBy: OPERATOR, summary: "both formats ship" });
    expect(closed).toMatchObject({ milestones: ["G1"], tasks: { total: 2, landed: 2 }, tracksClosed: [], tracksLeft: [], missing: ["G1"] });
  });

  test("records the commit on main it closed at, and a stage the config lists gets an entry with only its closing fields", async () => {
    const { repo, root } = await ready();
    await landedIn(repo, "B2");
    const tip = await sh(root, ["rev-parse", "--short=7", "main"]);

    await closePhase(repo, OPERATOR, { phase: "B", summary: "widened" }, NOW);

    const entry = (await readPhases(repo.recordsDir)).phases.find((phase) => phase.id === "B");
    expect(entry).toEqual({ id: "B", closedAt: NOW.toISOString(), closedBy: OPERATOR, summary: "widened", commit: tip });
  });

  test("says which of its milestones have no build-log section, and not those that have one", async () => {
    const { repo } = await ready();
    await milestoneIn(repo, "G", "G2", "data", ["1 json"]);
    await landedIn(repo, "G2");
    await appendBuildlog(repo, { group: "exports", milestone: "G2", title: "json", date: "2026-11-14", markdown: "built" });

    const closed = await closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW);

    expect(closed.missing).toEqual(["G1"]);
  });

  test("closes the tracks tally opened whose tasks all belong to the phase, and leaves any other track", async () => {
    const { repo, data, fresh } = await ready();
    const owned = await openTrack(repo, data, { name: "exports", purpose: "the exports" }, OPENED);
    const shared = await openTrack(await fresh(), data, { name: "shared", purpose: "both" }, OPENED);
    const { Records } = await import("../../src/store/records.ts");
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => (milestone.id === "G1" ? { ...milestone, tasks: [...milestone.tasks, { id: "3 own", track: "exports", status: "landed" as const, commit: "abc1234", also: [] }, { id: "4 shared", track: "shared", status: "landed" as const, commit: "abc1234", also: [] }] } : milestone.id === "B2" ? { ...milestone, tasks: [...milestone.tasks, { id: "9 shared", track: "shared", status: "planned" as const, also: [] }] } : milestone)) }, message: "tracks" }));

    const closed = await closePhase(await fresh(), OPERATOR, { phase: "G", summary: "s" }, NOW);

    expect(closed.tracksClosed).toEqual(["exports"]);
    expect(closed.tracksLeft).toEqual([]);
    expect(await isThere(owned.track.worktree)).toBe(false);
    expect(await isThere(shared.track.worktree)).toBe(true);
  });

  test("names a track that could not close and why, and still closes the phase", async () => {
    const { repo, root, fresh } = await ready();
    const operatorTree = await openTrack(repo, OPERATOR, { name: "exports", purpose: "the exports" }, OPENED);
    const { Records } = await import("../../src/store/records.ts");
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => (milestone.id === "G1" ? { ...milestone, tasks: [...milestone.tasks, { id: "3 own", track: "exports", status: "landed" as const, commit: "abc1234", also: [] }] } : milestone)) }, message: "tracks" }));
    await writeFile(join(operatorTree.track.worktree, "draft.rs"), "x\n");

    const closed = await closePhase(await fresh(), OPERATOR, { phase: "G", summary: "s" }, NOW);

    expect(closed.tracksClosed).toEqual([]);
    expect(closed.tracksLeft).toHaveLength(1);
    expect(closed.tracksLeft[0]?.name).toBe("exports");
    expect(closed.tracksLeft[0]?.why).toContain("uncommitted work");
    expect((await readPhases(repo.recordsDir)).phases.find((phase) => phase.id === "G")?.closedAt).toBe(NOW.toISOString());
    expect(await sh(root, ["status", "--porcelain", "-uall"])).toBe("");
  });

  test("tells every session with one line in its inbox", async () => {
    const { repo, trees } = await ready();
    await openSession(repo, { worktree: trees["data"]!, agent: "claude" });

    await closePhase(repo, OPERATOR, { phase: "G", summary: "both formats ship" }, NOW);

    const texts = (await listNotes(repo, { track: "data", state: "all" })).map((note) => note.text);
    expect(texts).toEqual(["phase G was closed by operator: both formats ship"]);
  });

  test("when the commit fails, the phase stays closed, the answer carries git's words, and records_commit makes the commit later", async () => {
    const { repo, root } = await ready();
    await writeFile(join(root, ".git", "index.lock"), "");

    const closed = await closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW);

    expect(closed.commit).toBeNull();
    expect(closed.problem).toContain("git add");
    expect((await readPhases(repo.recordsDir)).phases.find((phase) => phase.id === "G")?.closedAt).toBe(NOW.toISOString());
    const { rm } = await import("node:fs/promises");
    await rm(join(root, ".git", "index.lock"));
    expect(await commitWaitingRecords(repo, OPERATOR, "after a failed close")).toMatchObject({ commit: expect.stringMatching(/^[0-9a-f]{7}$/) });
  }, 20_000);

  test("while a landing has its turn the commit waits, and the flush after that landing makes it", async () => {
    const { repo, root, count } = await ready();
    const ticket = await queued(repo, "engine", "turn");
    const before = await count();

    const closed = await closePhase(repo, OPERATOR, { phase: "G", summary: "both formats ship" }, NOW);

    expect(closed).toMatchObject({ commit: null, waits: expect.stringContaining("landing") });
    expect(await count()).toBe(before);
    await queueFile(repo).update((queue) => ({ value: { tickets: queue.tickets.filter((one) => one.id !== ticket) }, result: undefined }));
    const flushed = await flushWhenFree(repo);
    expect(flushed).toMatch(/^[0-9a-f]{7}$/);
    expect(await count()).toBe(before + 1);
    expect(await sh(root, ["log", "-1", "--format=%b"])).toBe("both formats ship");
    expect(await flushWhenFree(repo)).toBeNull();
  });

  test("in the each mode the phase's own write commits at once, and in the never mode nothing is committed", async () => {
    const each = await ready({ commit: true });
    const never = await ready({ commit: false });
    const beforeNever = await never.count();

    const first = await closePhase(each.repo, OPERATOR, { phase: "G", summary: "s" }, NOW);
    const second = await closePhase(never.repo, OPERATOR, { phase: "G", summary: "s" }, NOW);

    expect(first.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(second.commit).toBeNull();
    expect(second.problem).toBeUndefined();
    expect(await never.count()).toBe(beforeNever);
  });
});
