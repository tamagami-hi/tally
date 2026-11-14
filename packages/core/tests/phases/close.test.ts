import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { flushPendingPhase, flushRecords, flushWhenFree } from "../../src/records/commit.ts";
import { putEntry } from "../../src/context/entries.ts";
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
    expect(closed).toMatchObject({ milestones: ["G1"], tasks: { total: 2, landed: 2 }, tracksClosed: [], tracksLeft: [], withoutBuildLog: ["G1"] });
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

    expect(closed.withoutBuildLog).toEqual(["G1"]);
    expect(closed).not.toHaveProperty("missing");
  });

  test("leaves withoutBuildLog out when every milestone of the phase has a build-log section", async () => {
    const { repo } = await ready();
    await appendBuildlog(repo, { group: "exports", milestone: "G1", title: "csv", date: "2026-11-14", markdown: "built" });

    const closed = await closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW);

    expect(closed).not.toHaveProperty("withoutBuildLog");
    expect(closed).not.toHaveProperty("missing");
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

  test("a commit made some other way while it waited clears the wait, so the next phase's records are not committed as this one's", async () => {
    const { repo, root, count } = await ready();
    const ticket = await queued(repo, "engine", "turn");
    await closePhase(repo, OPERATOR, { phase: "G", summary: "both formats ship" }, NOW);
    await queueFile(repo).update((queue) => ({ value: { tickets: queue.tickets.filter((one) => one.id !== ticket) }, result: undefined }));
    await commitWaitingRecords(repo, OPERATOR, "by hand");
    await putEntry(repo, DATA, { kind: "finding", title: "later", text: "work of the next phase" });
    const before = await count();

    expect(await flushWhenFree(repo)).toBeNull();
    expect(await flushPendingPhase(repo)).toBeNull();

    expect(await count()).toBe(before);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toMatch(/by hand$/);
  });

  test("an explicit flush clears the wait too", async () => {
    const { repo } = await ready();
    const ticket = await queued(repo, "engine", "turn");
    await closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW);
    await queueFile(repo).update((queue) => ({ value: { tickets: queue.tickets.filter((one) => one.id !== ticket) }, result: undefined }));

    await flushRecords(repo);
    await putEntry(repo, DATA, { kind: "finding", title: "later", text: "next" });

    expect(await flushPendingPhase(repo)).toBeNull();
  });

  test("the service's own flush commits a close that waited when no landing's end followed it", async () => {
    const { repo, root, count } = await ready();
    const ticket = await queued(repo, "engine", "turn");
    const before = await count();
    await closePhase(repo, OPERATOR, { phase: "G", summary: "both formats ship" }, NOW);
    await queueFile(repo).update((queue) => ({ value: { tickets: queue.tickets.filter((one) => one.id !== ticket) }, result: undefined }));

    const flushed = await flushPendingPhase(repo);

    expect(flushed).toMatch(/^[0-9a-f]{7}$/);
    expect(await count()).toBe(before + 1);
    expect(await sh(root, ["log", "-1", "--format=%b"])).toBe("both formats ship");
    expect(await flushPendingPhase(repo)).toBeNull();
  });

  test("the service's own flush does nothing while a landing still has its turn, and when no close waits", async () => {
    const { repo, count } = await ready();
    const before = await count();
    expect(await flushPendingPhase(repo)).toBeNull();
    await queued(repo, "engine", "turn");
    await closePhase(repo, OPERATOR, { phase: "G", summary: "s" }, NOW);

    expect(await flushPendingPhase(repo)).toBeNull();
    expect(await count()).toBe(before);
  });

  test("a second close of the same phase that passed the first check is refused inside the write", async () => {
    const { repo } = await ready();
    const closes = await Promise.allSettled([closePhase(repo, OPERATOR, { phase: "G", summary: "first" }, NOW), closePhase(repo, OPERATOR, { phase: "G", summary: "second" }, NOW)]);

    expect(closes.map((one) => one.status).sort()).toEqual(["fulfilled", "rejected"]);
    const kept = (await readPhases(repo.recordsDir)).phases.find((phase) => phase.id === "G");
    expect(["first", "second"]).toContain(kept?.summary);
    expect((await listNotes(repo, { track: "data", state: "all" })).filter((note) => note.text.startsWith("phase G was closed"))).toHaveLength(1);
  });
});
