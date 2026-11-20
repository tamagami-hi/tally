import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { cycleDir, readCycles } from "../../src/cycles/file.ts";
import { checkLedger } from "../../src/ledger/audit.ts";
import { postNote, readNotes } from "../../src/records/notes.ts";
import { readReviews } from "../../src/records/reviews.ts";
import { Records } from "../../src/store/records.ts";
import { AT, cycling } from "../support/cycling.ts";
import { sh } from "../support/repo.ts";

const SAID = "yes, close the first cycle";

type Raw = Record<string, unknown>;

const raw = async (path: string): Promise<Raw> => JSON.parse(await readFile(path, "utf8")) as Raw;
const ids = (items: unknown): string[] => (items as { id?: string; name?: string; milestone?: string }[]).map((item) => item.id ?? item.name ?? item.milestone ?? "");
const names = async (dir: string): Promise<string[]> => (await readdir(dir).catch(() => [])).sort();

describe("closing a cycle", () => {
  test("moves each file's finished part into the cycle's folder and keeps the rest, as the table says", async () => {
    const { repo, root, operator, landed } = await cycling();

    const closed = await closeCycle(repo, operator, { summary: "the reader is built", said: SAID, name: "the reader" }, AT);

    const cycle = cycleDir(repo.recordsDir, 1);
    const tip = await sh(root, ["rev-parse", "--short=7", "main~1"]);
    expect(closed).toMatchObject({ cycle: 1, next: 2, tracksClosed: ["docs"], archived: { milestones: ["A1"], tasks: 1, tracks: ["docs"] }, carried: { milestones: ["A2"], tracks: ["eng"], parked: [{ task: "A1:1 read", what: "the XML", why: "no client reads it" }] } });
    expect(ids((await raw(join(cycle, "ledger.json")))["milestones"])).toEqual(["A1"]);
    expect(await raw(join(repo.recordsDir, "ledger.json"))).toMatchObject({ baseline: tip, other: [] });
    expect(ids((await raw(join(repo.recordsDir, "ledger.json")))["milestones"])).toEqual(["A2"]);
    expect(ids((await raw(join(cycle, "tracks.json")))["tracks"])).toEqual(["docs"]);
    expect(ids((await raw(join(repo.recordsDir, "tracks.json")))["tracks"])).toEqual(["eng"]);
    expect((await raw(join(cycle, "phases.json")))["phases"]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "B", summary: "closed with cycle 1" }), expect.objectContaining({ id: "C" })]));
    expect(ids((await raw(join(repo.recordsDir, "phases.json")))["phases"])).toEqual(["C"]);
    expect(ids((await raw(join(cycle, "reviews.json")))["reviews"])).toEqual(["review-1"]);
    expect((await raw(join(repo.recordsDir, "reviews.json")))).toMatchObject({ nextId: 2, reviews: [] });
    expect(ids((await raw(join(cycle, "buildlog.json")))["entries"])).toEqual(["A1"]);
    expect(ids((await raw(join(repo.recordsDir, "buildlog.json")))["entries"])).toEqual(["A2"]);
    expect(await names(join(cycle, "evidence"))).toEqual(["A1.json"]);
    expect(await names(join(repo.recordsDir, "evidence"))).toEqual([]);
    expect(await names(join(cycle, "handoffs"))).toEqual(["docs.json"]);
    expect(await names(join(repo.recordsDir, "handoffs"))).toEqual(["data.json"]);
    expect(await names(join(cycle, "log"))).toEqual(["2026-11-20.json"]);
    expect(await names(join(repo.recordsDir, "log"))).toEqual([]);
    expect(((await raw(join(cycle, "context/notes.json")))["notes"] as { text: string }[]).map((note) => note.text)).toEqual(["the reader is in", "write the reader's page"]);
    expect((await readNotes(repo)).notes.map((note) => note.text)).toEqual(["the writer is next", "cycle 1 was closed by operator: the reader is built"]);
    expect(landed).toHaveLength(7);
  });

  test("records the cycle in cycles.json, with the operator's words, and moves the current cycle on", async () => {
    const { repo, root, operator } = await cycling();

    const closed = await closeCycle(repo, operator, { summary: "the reader is built", said: SAID, decision: "DEC-3" }, AT);

    expect(await readCycles(repo.recordsDir)).toEqual({ schema: 1, current: 2, cycles: [expect.objectContaining({ n: 1, said: SAID, decision: "DEC-3", summary: "the reader is built", closedAt: AT.toISOString(), closedBy: { track: "main", agent: "operator" }, to: await sh(root, ["rev-parse", "--short=7", "main~1"]) })] });
    expect(closed.commit).not.toBeNull();
    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: cycle 1 closed");
    expect(await sh(root, ["status", "--porcelain", "--", "docs/records"])).toBe("");
  });

  test("keeps the counters, so the next review and note take the next number", async () => {
    const { repo, operator } = await cycling();
    const before = await readNotes(repo);

    await closeCycle(repo, operator, { summary: "done", said: SAID }, AT);
    const note = await postNote(repo, operator, { to: "all", kind: "heads-up", text: "cycle 2 begins" }, AT);

    expect(note.id).toBe(`note-${before.nextNumber + 1}`);
    expect((await readReviews(repo)).nextId).toBe(2);
  });

  test("leaves ledger_check clean, and a commit made after it is owed", async () => {
    const { repo, root, operator } = await cycling();
    await closeCycle(repo, operator, { summary: "done", said: SAID }, AT);

    const clean = (await checkLedger(repo, await new Records(repo).readLedger())).check.missing;
    await sh(root, ["commit", "-q", "--allow-empty", "-m", "feat: after the close"]);
    const owed = (await checkLedger(repo, await new Records(repo).readLedger())).check.missing;

    expect(clean).toEqual([]);
    expect(owed).toHaveLength(1);
  });
});
