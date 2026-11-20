import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { carryOut } from "../../src/cycles/carry.ts";
import { closeCycle } from "../../src/cycles/close.ts";
import { cycleList, cycleOne } from "../../src/cycles/list.ts";
import { closingPath } from "../../src/cycles/file.ts";
import { finishPendingClose } from "../../src/cycles/finish.ts";
import { planClose, type ClosePlan } from "../../src/cycles/plan.ts";
import { writeJsonAtomic } from "../../src/store/json.ts";
import { Records, reopenRepo, type Repo } from "../../src/store/records.ts";
import { closeOpened } from "../../src/tracks/close.ts";
import { changeTracks } from "../../src/tracks/file.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { AT, cycling, type Cycling } from "../support/cycling.ts";
import { BY, CLOSE_INPUT } from "../support/pending.ts";

const STAMP = "2026-11-19T10-00-00Z";
const FIXED_STEPS = 12;

const closedDir = (made: Pick<Cycling, "root">, ...parts: string[]): string => join(made.root, ".temp/closed", ...parts);
const listed = async (folder: string): Promise<string[]> => (await readdir(folder).catch(() => [])).sort();
const noted = async (made: Pick<Cycling, "root">, track: string): Promise<void> => {
  await mkdir(join(made.root, ".temp/worktrees", track, ".temp", track), { recursive: true });
  await writeFile(join(made.root, ".temp/worktrees", track, ".temp", track, "notes.md"), `${track}'s notes\n`);
};
const byHand = async (made: Pick<Cycling, "root">, name: string, file = "old.md"): Promise<void> => {
  await mkdir(closedDir(made, name), { recursive: true });
  await writeFile(closedDir(made, name, file), "kept before\n");
};

async function closing(made: Cycling, close: readonly string[], legacy: readonly string[] = []): Promise<{ repo: Repo; plan: ClosePlan }> {
  for (const name of close) await closeOpened(await reopenRepo(made.repo), name, { by: BY, now: AT, why: "cycle 1 closed", commit: false });
  await changeTracks(made.repo.recordsDir, async (file) => ({ file: { ...file, tracks: file.tracks.map(({ keptFolders, ...track }) => (legacy.includes(track.name) ? track : { ...track, ...(keptFolders === undefined ? {} : { keptFolders }) })) }, result: undefined }));
  const repo = await reopenRepo(made.repo);
  const plan = await planClose(repo, await new Records(repo).readLedger(), { by: BY, now: AT, input: CLOSE_INPUT });
  await writeJsonAtomic(closingPath(repo.recordsDir, 1), plan);
  return { repo, plan };
}

describe("what closed lanes kept, at a cycle's close", () => {
  test("the folders of the tracks archived move to .temp/closed/cycle-<n>/ under their own names, and a config track's stays", async () => {
    const made = await cycling();
    await noted(made, "docs");
    await noted(made, "eng");
    await byHand(made, "data");
    const { repo, plan } = await closing(made, ["docs", "eng"]);

    await carryOut(repo, plan);

    expect(await listed(closedDir(made, "cycle-1"))).toEqual(["docs", "eng"]);
    expect(await listed(closedDir(made, "cycle-1", "docs"))).toEqual(["notes.md"]);
    expect(await listed(closedDir(made))).toEqual(["cycle-1", "data"]);
  });

  test("for a track closed before this release, the folder of its exact name and a stamped second one move, and another track's whose name it begins do not", async () => {
    const made = await cycling();
    await openTrack(await reopenRepo(made.repo), made.operator, { name: "doc", purpose: "the doc" }, AT);
    for (const name of ["doc", `doc-${STAMP}`, "docs", `docs-${STAMP}`, "doc-notes"]) await byHand(made, name);
    const { repo, plan } = await closing(made, ["doc"], ["doc"]);

    await carryOut(repo, plan);

    expect(await listed(closedDir(made, "cycle-1"))).toEqual(["doc", `doc-${STAMP}`]);
    expect(await listed(closedDir(made))).toEqual(["cycle-1", "doc-notes", "docs", `docs-${STAMP}`]);
  });

  test("a close stopped after any step, before the moves, between them or after them, is finished with the folders moved once", async () => {
    for (const offset of [-1, 0, 1, 2, 3]) {
      const made = await cycling();
      await noted(made, "docs");
      await noted(made, "eng");
      const { repo, plan } = await closing(made, ["docs", "eng"]);
      const steps = FIXED_STEPS + plan.moves.length + offset;

      await carryOut(repo, plan, steps);
      await finishPendingClose(repo);

      expect([steps, await listed(closedDir(made, "cycle-1")), await listed(closedDir(made, "cycle-1", "eng"))]).toEqual([steps, ["docs", "eng"], ["notes.md"]]);
    }
  }, 120_000);

  test("never replaces a folder the cycle's folder already holds", async () => {
    const made = await cycling();
    await noted(made, "docs");
    await byHand(made, join("cycle-1", "docs"), "other.md");
    const { repo, plan } = await closing(made, ["docs"]);

    await carryOut(repo, plan);

    expect(await listed(closedDir(made, "cycle-1", "docs"))).toEqual(["other.md"]);
    expect(await listed(closedDir(made, "docs"))).toEqual(["notes.md"]);
  });
});

describe("the kept folder in the answers", () => {
  test("cycle_close answers what it moved, and cycle_list names the cycle's kept folder, with n and without", async () => {
    const made = await cycling();
    await noted(made, "docs");
    await closeOpened(made.repo, "eng", { by: BY, now: AT, why: "done", commit: false });

    const closed = await closeCycle(await reopenRepo(made.repo), made.operator, { summary: "the reader is built", said: "close it" }, AT);
    const repo = await reopenRepo(made.repo);

    expect(closed.keptMoved).toEqual([join(".temp/closed/cycle-1", "docs")]);
    expect((await cycleList(repo, {})).closed[0]?.kept).toBe(join(".temp/closed", "cycle-1"));
    expect((await cycleOne(repo, 1)).kept).toBe(join(".temp/closed", "cycle-1"));
  });
});

describe("a recorded kept folder that is not a closed lane's", () => {
  test("is left where it is and named as not moved; only a direct child of .temp/closed/ that is no cycle's folder moves", async () => {
    const made = await cycling();
    await noted(made, "docs");
    await byHand(made, "cycle-3");
    await mkdir(join(made.root, "src"), { recursive: true });
    await closeOpened(made.repo, "eng", { by: BY, now: AT, why: "done", commit: false });
    const odd = ["src", "../outside", "/etc", ".temp/closed/docs/../../../src", ".temp/closed/cycle-3", ".temp/closed/eng/deeper"];
    await changeTracks(made.repo.recordsDir, async (file) => ({ file: { ...file, tracks: file.tracks.map((track) => (track.name === "eng" ? { ...track, keptFolders: odd } : track)) }, result: undefined }));

    const closed = await closeCycle(await reopenRepo(made.repo), made.operator, { summary: "the reader is built", said: "close it" }, AT);

    expect(closed.keptMoved).toEqual([join(".temp/closed/cycle-1", "docs")]);
    expect(closed.keptNotMoved).toEqual([...odd].sort());
    expect(await listed(closedDir(made))).toEqual(["cycle-1", "cycle-3"]);
    expect(await listed(join(made.root, "src"))).toEqual([]);
  });
});

describe("a kept folder's move read back from closing.json", () => {
  test("moves nothing that is not a closed lane's folder into a cycle's folder", async () => {
    const made = await cycling();
    await mkdir(join(made.root, "src"), { recursive: true });
    await writeFile(join(made.root, "src", "keep.txt"), "keep\n");
    await byHand(made, "x");
    const { moveKept } = await import("../../src/cycles/kept.ts");

    for (const move of [{ from: "src", to: ".temp/closed/cycle-1/src" }, { from: ".temp/closed/x", to: "src/x" }, { from: ".temp/closed/x", to: ".temp/closed/cycle-1/y" }]) await moveKept(made.repo, move);

    expect(await listed(join(made.root, "src"))).toEqual(["keep.txt"]);
    expect(await listed(closedDir(made))).toEqual(["x"]);
  });
});
