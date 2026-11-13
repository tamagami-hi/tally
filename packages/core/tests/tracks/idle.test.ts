import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { joinQueue } from "../../src/land/queue.ts";
import { listNotes } from "../../src/records/notes.ts";
import { configureRepo } from "../../src/repos/configure.ts";
import { claimsFile } from "../../src/state/claims.ts";
import { endSession } from "../../src/state/end.ts";
import { closeSession, openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { closeIdleTracks } from "../../src/tracks/idle.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { commitOn } from "../support/landing.ts";
import { helped, isThere, type Helped } from "../support/helped.ts";
import { sh } from "../support/repo.ts";

const OPENED = new Date("2026-11-12T09:00:00.000Z");
const after = (minutes: number): Date => new Date(OPENED.getTime() + minutes * 60_000);

async function addTask(made: Helped, track: string, status: "landed" | "planned"): Promise<void> {
  const task = status === "landed" ? { id: `${track} work`, track, status, commit: "abc1234", also: [] } : { id: `${track} work`, track, status, also: [] };
  await new Records(made.repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => ({ ...milestone, tasks: [...milestone.tasks, task] })) }, message: "planned" }));
}

async function landed(records: Parameters<typeof helped>[0] = {}): Promise<Helped> {
  const made = await helped(records, OPENED);
  await addTask(made, "helper", "landed");
  return made;
}

const notesTo = async (made: Helped, track: string): Promise<string[]> => (await listNotes(await made.fresh(), { track, state: "all" })).map((note) => note.text);
const recorded = async (root: string): Promise<{ tracks: { name: string; closedAt?: string; closedBy?: unknown; closedWhy?: string }[] }> => JSON.parse(await (await import("node:fs/promises")).readFile(join(root, "docs/records/tracks.json"), "utf8"));

describe("closing landed tracks that sit idle", () => {
  test("closes a track that meets every condition, and records that tally did it and why", async () => {
    const made = await landed();
    await writeFile(join(made.tree, ".temp", "helper", "notes.md"), "kept\n");

    const result = await closeIdleTracks(await made.fresh(), after(61));

    expect(result).toEqual({ closed: ["helper"], problems: [] });
    expect(await isThere(made.tree)).toBe(false);
    expect(await sh(made.root, ["branch", "--list", "track/helper"])).toBe("");
    expect((await recorded(made.root)).tracks[0]).toMatchObject({ name: "helper", closedAt: after(61).toISOString(), closedBy: { track: "main", agent: "tally" }, closedWhy: "landed, and idle since 2026-11-12T09:00:00.000Z" });
    expect(await isThere(join(made.root, ".temp", "closed", "helper", "notes.md"))).toBe(true);
  });

  test("tells the parent track once, in the words of the plan, and where the notes went", async () => {
    const made = await landed();
    await writeFile(join(made.tree, ".temp", "helper", "notes.md"), "kept\n");

    await closeIdleTracks(await made.fresh(), after(61));
    await closeIdleTracks(await made.fresh(), after(120));

    expect(await notesTo(made, "data")).toEqual(["track helper was closed: its work is on main and it sat idle for 61 minutes. Its notes are in .temp/closed/helper."]);
  });

  test("tells main when the track has no parent, and leaves out the notes sentence when it kept none", async () => {
    const made = await helped({}, OPENED);
    await addTask(made, "helper", "landed");
    const orphan = await openTrack(await made.fresh(), made.operator, { name: "orphan", purpose: "no parent" }, OPENED);
    await addTask(made, "orphan", "landed");

    await closeIdleTracks(await made.fresh(), after(61));

    expect(await isThere(orphan.track.worktree)).toBe(false);
    expect(await notesTo(made, "main")).toEqual(["track orphan was closed: its work is on main and it sat idle for 61 minutes."]);
  });

  test("waits the repository's own number of minutes when the config sets one", async () => {
    const made = await landed();
    const set = await configureRepo(made.repo, { track: "main", agent: "operator" }, { worktrees: { idleMinutes: 10 } });

    const early = await closeIdleTracks(await made.fresh(), after(9));
    const due = await closeIdleTracks(await made.fresh(), after(11));

    expect(set.config.worktrees).toEqual({ idleMinutes: 10 });
    expect(early.closed).toEqual([]);
    expect(due.closed).toEqual(["helper"]);
  });

  test("counts the rest from the later of the track's last session ending and its opening", async () => {
    const made = await landed();
    const session = await openSession(await made.fresh(), { worktree: made.tree, agent: "sonnet" }, after(10));
    await endSession(await made.fresh(), session.id, after(50));

    const early = await closeIdleTracks(await made.fresh(), after(61));
    const due = await closeIdleTracks(await made.fresh(), after(111));

    expect(early.closed).toEqual([]);
    expect(due.closed).toEqual(["helper"]);
    expect((await recorded(made.root)).tracks[0]?.closedWhy).toBe("landed, and idle since 2026-11-12T09:50:00.000Z");
  });

  test("counts the rest from the end of the track's last landing when that is later", async () => {
    const made = await landed();
    const session = await openSession(await made.fresh(), { worktree: made.tree, agent: "sonnet" }, after(5));
    await commitOn(made.tree, "src/part.rs", "feat: a part");
    const ticket = await joinQueue(made.repo, session, { files: [] });
    await sh(made.root, ["merge", "-q", "--ff-only", "track/helper"]);
    await closeSession(made.repo, session.id);
    const { queueFile } = await import("../../src/land/queue.ts");
    await queueFile(made.repo).update((queue) => ({ value: { tickets: queue.tickets.map((one) => (one.id === ticket.id ? { ...one, state: "landed" as const, endedAt: after(100).toISOString() } : one)) }, result: undefined }));

    const early = await closeIdleTracks(await made.fresh(), after(120));
    const due = await closeIdleTracks(await made.fresh(), after(161));

    expect(early.closed).toEqual([]);
    expect(due.closed).toEqual(["helper"]);
  });
});

describe("a track that is left alone", () => {
  type Spoil = (made: Helped) => Promise<void>;
  const spoils: [string, Spoil][] = [
    ["has a planned task", async (made) => addTask(made, "helper", "planned")],
    ["has no task at all", async (made) => {
      await new Records(made.repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => ({ ...milestone, tasks: milestone.tasks.filter((task) => task.track !== "helper") })) }, message: "none" }));
    }],
    ["has an open session", async (made) => void (await openSession(made.repo, { worktree: made.tree, agent: "sonnet" }, after(1)))],
    ["holds a claim", async (made) => {
      await claimsFile(made.repo).update((state) => ({ value: { claims: [...state.claims, { milestone: "B2", task: "helper work", track: "helper", sessionId: "gone", agent: "sonnet", since: OPENED.toISOString() }] }, result: undefined }));
    }],
    ["has a landing in the queue", async (made) => {
      const session = await openSession(made.repo, { worktree: made.tree, agent: "sonnet" }, after(1));
      await commitOn(made.tree, "src/part.rs", "feat: a part");
      await joinQueue(made.repo, session, { files: [] });
      await sh(made.root, ["merge", "-q", "--ff-only", "track/helper"]);
      await closeSession(made.repo, session.id);
    }],
    ["has an open child", async (made) => {
      const session = await openSession(made.repo, { worktree: made.tree, agent: "sonnet" }, after(1));
      await openTrack(await made.fresh(), session, { name: "kid", purpose: "a part" }, OPENED);
      await closeSession(made.repo, session.id);
    }],
    ["is ahead of main", async (made) => void (await commitOn(made.tree, "src/a.rs", "feat: a"))],
  ];

  test.each(spoils)("when it %s", async (_name, spoil) => {
    const made = await landed();
    await spoil(made);

    const result = await closeIdleTracks(await made.fresh(), after(300));

    expect(result).toEqual({ closed: [], problems: [] });
    expect(await isThere(made.tree)).toBe(true);
    expect(await sh(made.root, ["branch", "--list", "track/helper"])).toContain("track/helper");
  });

  test("when it has not rested for the whole time yet", async () => {
    const made = await landed();

    expect((await closeIdleTracks(await made.fresh(), after(59))).closed).toEqual([]);
    expect(await isThere(made.tree)).toBe(true);
  });

  test("when it is one of the config's, however landed and rested", async () => {
    const made = await landed();
    await addTask(made, "engine", "landed");

    const result = await closeIdleTracks(await made.fresh(), after(600));

    expect(result.closed).toEqual(["helper"]);
    expect(await isThere(made.trees["engine"] ?? "")).toBe(true);
  });

  test("when the repository keeps its worktrees", async () => {
    const made = await landed();
    await configureRepo(made.repo, { track: "main", agent: "operator" }, { worktrees: { keep: true } });

    const result = await closeIdleTracks(await made.fresh(), after(600));

    expect(result).toEqual({ closed: [], problems: [] });
    expect(await isThere(made.tree)).toBe(true);
  });
});

describe("a landed, idle track whose worktree holds uncommitted files", () => {
  test("is not closed, and the parent is told once, naming the files", async () => {
    const made = await landed();
    await writeFile(join(made.tree, "draft.rs"), "x\n");

    const first = await closeIdleTracks(await made.fresh(), after(61));
    const second = await closeIdleTracks(await made.fresh(), after(90));

    expect(first.closed).toEqual([]);
    expect(second.closed).toEqual([]);
    expect(await notesTo(made, "data")).toEqual(["track helper is landed and idle, but its worktree holds uncommitted files: draft.rs; commit them, delete them, or close the track yourself"]);
    expect(await isThere(made.tree)).toBe(true);
  });

  test("closes on a later pass once the files are gone", async () => {
    const made = await landed();
    await writeFile(join(made.tree, "draft.rs"), "x\n");
    await closeIdleTracks(await made.fresh(), after(61));
    await sh(made.tree, ["clean", "-fdq"]);

    const result = await closeIdleTracks(await made.fresh(), after(90));

    expect(result.closed).toEqual(["helper"]);
  });
});

describe("a track that fails to close", () => {
  test("does not stop the next one, and is reported", async () => {
    const made = await landed();
    await openTrack(await made.fresh(), made.operator, { name: "second", purpose: "another" }, OPENED);
    await addTask(made, "second", "landed");
    await sh(made.root, ["worktree", "remove", made.tree]);
    await sh(made.root, ["branch", "-D", "track/helper"]);

    const result = await closeIdleTracks(await made.fresh(), after(61));

    expect(result.closed).toEqual(["second"]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("helper");
  });
});
