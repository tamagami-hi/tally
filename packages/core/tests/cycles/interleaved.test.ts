import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { finishPendingClose } from "../../src/cycles/finish.ts";
import { cyclesPath } from "../../src/cycles/file.ts";
import { postNote } from "../../src/records/notes.ts";
import type { Ledger, OtherCommit } from "../../src/schema/ledger.ts";
import { Records } from "../../src/store/records.ts";
import { isOpen, readTracks } from "../../src/tracks/file.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT, OPERATIONS, SOON, bothFolders, delay, holding, isPending, listOf, pendingClose, withTask } from "../support/pending.ts";

interface Item {
  id: string;
  text?: string;
  tasks?: { id: string }[];
}

const AFTER = "abcdef1";
const STEPS = Array.from({ length: OPERATIONS + 1 }, (_, index) => index);

const idsIn = (file: Record<string, unknown> | undefined, key: string): string[] => listOf<Item>(file, key).map((item) => item.id);
const tasksOf = (file: Record<string, unknown> | undefined, milestone: string): string[] => (listOf<Item>(file, "milestones").find((one) => one.id === milestone)?.tasks ?? []).map((task) => task.id);

async function everyNote(made: Awaited<ReturnType<typeof cycling>>): Promise<Item[]> {
  const notes = await bothFolders(made.repo, "context/notes.json");
  return [...listOf<Item>(notes.current, "notes"), ...listOf<Item>(notes.cycle, "notes")];
}

const withOther = (ledger: Ledger): Ledger => ({ ...ledger, other: [...ledger.other, { commit: AFTER, note: "a fix made after the crash" }] });

describe("a write made while a cycle closes", () => {
  test("a ledger write held open across the close is kept, and the archived milestones do not come back", async () => {
    const made = await cycling();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => { release = done; });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((done) => { entered = done; });
    const writing = new Records(made.repo).update(async (ledger) => {
      entered();
      await gate;
      return { ledger: withTask(ledger, "A2", "3 more"), message: "planned" };
    });
    await inside;

    const closing = closeCycle(made.repo, made.operator, CLOSE_INPUT, AT);
    await delay(300);
    release();
    await writing;
    await closing;

    const ledger = await bothFolders(made.repo, "ledger.json");
    expect(idsIn(ledger.current, "milestones")).toEqual(["A2"]);
    expect(tasksOf(ledger.current, "A2")).toEqual(["2 write", "3 more"]);
    expect(idsIn(ledger.cycle, "milestones")).toEqual(["A1"]);
  });

  test("a note posted and a task planned between the plan and its carrying out are kept, each once, and no note id is given twice", async () => {
    const made = await cycling();
    await pendingClose(made);

    await postNote(made.repo, made.operator, { to: "all", kind: "heads-up", text: "posted mid close" }, AT);
    await new Records(made.repo).update((ledger) => ({ ledger: withTask(ledger, "A2", "3 more"), message: "planned" }));
    await finishPendingClose(made.repo);

    const notes = await everyNote(made);
    expect(notes.filter((note) => note.text === "posted mid close")).toHaveLength(1);
    expect(new Set(notes.map((note) => note.id)).size).toBe(notes.length);
    expect(notes.filter((note) => note.text?.startsWith("cycle 1 was closed by operator"))).toHaveLength(1);
    expect(tasksOf((await bothFolders(made.repo, "ledger.json")).current, "A2")).toEqual(["2 write", "3 more"]);
  });

  test.each(STEPS)("a write made after a crash at step %i is in one of the two folders, once, when the close is finished", async (steps) => {
    const made = await cycling();
    await pendingClose(made, steps);

    await postNote(made.repo, made.operator, { to: "all", kind: "heads-up", text: "after the crash" }, AT);
    await new Records(made.repo).update((ledger) => ({ ledger: withOther(withTask(ledger, "A2", "3 more")), message: "planned" }));
    await finishPendingClose(made.repo);

    const notes = await everyNote(made);
    const ledger = await bothFolders(made.repo, "ledger.json");
    const others = [...listOf<OtherCommit>(ledger.current, "other"), ...listOf<OtherCommit>(ledger.cycle, "other")].filter((one) => one.commit === AFTER);
    expect(await isPending(made.repo)).toBe(false);
    expect(notes.filter((note) => note.text === "after the crash")).toHaveLength(1);
    expect(new Set(notes.map((note) => note.id)).size).toBe(notes.length);
    expect(others).toHaveLength(1);
    expect(idsIn(ledger.current, "milestones")).toEqual(["A2"]);
    expect(tasksOf(ledger.current, "A2")).toEqual(["2 write", "3 more"]);
    expect(idsIn(ledger.cycle, "milestones")).toEqual(["A1"]);
  });
});

describe("a lock the close cannot take", () => {
  test("ends the close before anything is written, and names the lock", async () => {
    const made = await cycling();
    const held = await holding(cyclesPath(made.repo.recordsDir));

    const closing = closeCycle(made.repo, made.operator, CLOSE_INPUT, AT, SOON);
    await expect(closing).rejects.toThrow("cycle 1 was not closed: could not take the lock cycles.json");
    await held.release();

    const ledger = await bothFolders(made.repo, "ledger.json");
    expect(idsIn(ledger.current, "milestones")).toEqual(["A1", "A2"]);
    expect(ledger.cycle).toBeUndefined();
    expect(await isPending(made.repo)).toBe(false);
    expect((await readTracks(made.repo.recordsDir)).tracks.filter(isOpen).map((track) => track.name)).toEqual(["docs", "eng"]);
  });
});
