import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { plan } from "../../src/ledger/ops.ts";
import { LOGS, RESULTS, RUNNER, writeRunner } from "../../src/land/runner.ts";
import { listEvidence } from "../../src/records/evidence.ts";
import { readNotes } from "../../src/records/notes.ts";
import { MOST_RETRIED, takeResults } from "../../src/records/results.ts";
import { removeTask } from "../../src/records/task-removal.ts";
import { Records } from "../../src/store/records.ts";
import { makeTracked, type Tracked } from "../support/tracked.ts";

const REFUSED_AT = new Date("2026-11-01T09:00:00.000Z");

function run(tree: string, args: readonly string[]): Promise<void> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, () => done());
  });
}

async function ready(): Promise<Tracked & { tree: string }> {
  const tracked = await makeTracked();
  const tree = tracked.trees["data"] ?? "";
  await writeRunner(tracked.repo, tree, "data");
  return { ...tracked, tree };
}

const left = async (tree: string, folder: string): Promise<string[]> => readdir(join(tree, RESULTS, folder)).catch(() => []);

const planOn = (tracked: Tracked, track: string, task: string): Promise<string> => new Records(tracked.repo).update((ledger) => plan(ledger, { milestone: "B2", track, tasks: [task] }));

const notesTo = async (tracked: Tracked, track: string): Promise<string[]> => (await readNotes(tracked.repo)).notes.filter((note) => note.to.includes(track)).map((note) => note.text);

async function refusedByHand(tracked: Tracked & { tree: string }, id: string, task: string): Promise<void> {
  const folder = join(tracked.tree, RESULTS, "refused", id);
  const log = join(tracked.root, LOGS, "data", `${id}-green.log`);
  await mkdir(folder, { recursive: true });
  await mkdir(join(tracked.root, LOGS, "data"), { recursive: true });
  await writeFile(log, "ok\n");
  const fields: Record<string, string> = { kind: "green", task: `B2:${task}`, note: "", head: "", cwd: tracked.tree, started: "2026-11-17T09:00:00Z", seconds: "1", exit: "0", log, argv: "true\0", problem: `'${task}' is not planned in B2` };
  for (const [name, value] of Object.entries(fields)) await writeFile(join(folder, name), name === "argv" ? value : `${value}\n`);
  await utimes(join(folder, "problem"), REFUSED_AT, REFUSED_AT);
}

describe("a refused result, once the ledger changes", () => {
  test("is recorded when its task is now planned on its track, with no hand move, and loses its problem", async () => {
    const tracked = await ready();
    await planOn(tracked, "engine", "9 moved");
    await run(tracked.tree, ["green", "--task", "B2:9 moved", "--", "true"]);
    const [refused] = await takeResults(tracked.repo);
    expect(refused?.problem).toMatch(/may not write track engine's records/);
    await removeTask(tracked.repo, { milestone: "B2", task: "9 moved", why: "it is data's" });
    await planOn(tracked, "data", "9 moved");

    const [taken] = await takeResults(tracked.repo);

    expect(taken).toMatchObject({ id: refused?.id, record: { task: "9 moved", track: "data", kind: "green" } });
    expect(await left(tracked.tree, "refused")).toEqual([]);
    expect(await left(tracked.tree, "taken")).toEqual([refused?.id]);
    expect(await readdir(join(tracked.tree, RESULTS, "taken", refused?.id ?? ""))).not.toContain("problem");
    expect((await listEvidence(tracked.repo, "B2", "9 moved")).map((record) => record.track)).toEqual(["data"]);
  });

  test("stays refused when the reason still holds, with its problem rewritten and no second note", async () => {
    const tracked = await ready();
    await run(tracked.tree, ["green", "--task", "B2:nowhere", "--", "true"]);
    await takeResults(tracked.repo);
    const problem = join(tracked.tree, RESULTS, "refused", (await left(tracked.tree, "refused"))[0] ?? "", "problem");
    const before = (await stat(problem)).mtimeMs;
    await planOn(tracked, "data", "6 unrelated");

    const again = await takeResults(tracked.repo);

    expect(again.map((one) => one.problem)).toEqual(["'nowhere' is not planned in B2"]);
    expect((await stat(problem)).mtimeMs).toBeGreaterThan(before);
    expect(await notesTo(tracked, "data")).toHaveLength(1);
    expect(await takeResults(tracked.repo)).toEqual([]);
  });

  test("tells the track again only when the reason has changed", async () => {
    const tracked = await ready();
    await run(tracked.tree, ["green", "--task", "B2:7 later", "--", "true"]);
    await takeResults(tracked.repo);
    await planOn(tracked, "engine", "7 later");

    const [again] = await takeResults(tracked.repo);

    expect(again?.problem).toMatch(/may not write track engine's records/);
    const told = await notesTo(tracked, "data");
    expect(told).toHaveLength(2);
    expect(told[1]).toContain("may not write track engine's records");
  });

  test("is not tried again while the ledger has not changed since it was refused", async () => {
    const tracked = await ready();
    await run(tracked.tree, ["green", "--task", "B2:nowhere", "--", "true"]);
    await takeResults(tracked.repo);

    expect(await takeResults(tracked.repo)).toEqual([]);
    expect(await notesTo(tracked, "data")).toHaveLength(1);
  });

  test("is tried at most twenty to a worktree in one pass, the rest in the next", async () => {
    const tracked = await ready();
    const ids = Array.from({ length: MOST_RETRIED + 5 }, (_, at) => `20261117T0900${String(at).padStart(2, "0")}Z-${at + 100}`);
    for (const id of ids) await refusedByHand(tracked, id, "8 waiting");
    await planOn(tracked, "data", "8 waiting");

    const first = await takeResults(tracked.repo);
    const second = await takeResults(tracked.repo);

    expect(MOST_RETRIED).toBe(20);
    expect(first.map((one) => one.id)).toEqual(ids.slice(0, MOST_RETRIED));
    expect(second.map((one) => one.id)).toEqual(ids.slice(MOST_RETRIED));
    expect(await listEvidence(tracked.repo, "B2", "8 waiting")).toHaveLength(ids.length);
  });
});

describe("the note about a refused result", () => {
  test("says the result is kept and tried again when the ledger changes", async () => {
    const tracked = await ready();
    await run(tracked.tree, ["green", "--task", "B2:nowhere", "--", "true"]);

    await takeResults(tracked.repo);

    const [text] = await notesTo(tracked, "data");
    expect(text).toMatch(/; the result is kept in .*refused\/[^ ]+ and tried again when the ledger changes$/);
    expect(await readFile(join(tracked.tree, RESULTS, "refused", (await left(tracked.tree, "refused"))[0] ?? "", "problem"), "utf8")).toBe("'nowhere' is not planned in B2\n");
  });
});
