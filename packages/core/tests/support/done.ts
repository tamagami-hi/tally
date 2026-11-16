import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { addPhase } from "../../src/phases/add.ts";
import { changePhases } from "../../src/phases/file.ts";
import type { Milestone, Task } from "../../src/schema/ledger.ts";
import { Records, openRepo, type Repo } from "../../src/store/records.ts";
import { OPERATOR } from "./context.ts";
import { IDENTITY, sh } from "./repo.ts";
import { makeTracked } from "./tracked.ts";

const run = promisify(execFile);

export const CLOSED_G = "2026-11-14T12:00:00.000Z";
export const CLOSED_H = "2026-11-15T09:30:00.000Z";
export const READER_COMMITTED = "2026-11-10T10:00:00.000Z";
export const WRITER_RECORDED = "2026-11-12T09:00:00.000Z";
export const CSV_COMMITTED = "2026-11-13T16:45:00.000Z";

export interface Finished {
  repo: Repo;
  root: string;
  commits: Record<string, string>;
}

async function commitAt(root: string, file: string, when: string): Promise<string> {
  await writeFile(join(root, file), `${when}\n`);
  await sh(root, ["add", "--", file]);
  await run("git", [...IDENTITY, "commit", "-q", "-m", `feat: ${file}`], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  return sh(root, ["rev-parse", "--short=7", "HEAD"]);
}

const landed = (id: string, commit: string, more: Partial<Task> = {}): Task => ({ id, track: "data", status: "landed", commit, also: [], ...more });
const planned = (id: string): Task => ({ id, track: "data", status: "planned", also: [] });
const milestone = (id: string, stage: string, tasks: Task[], more: Partial<Milestone> = {}): Milestone => ({ id, stage, name: `${id} work`, track: "data", weight: 1, tasks, ...more });

async function closePhases(repo: Repo): Promise<void> {
  await changePhases(repo.recordsDir, (file) => ({
    file: {
      ...file,
      phases: file.phases.map((phase) => {
        if (phase.id === "G") return { ...phase, closedAt: CLOSED_G, closedBy: { track: "main", agent: "operator" }, summary: "The exports shipped.", commit: "c0ffee1" };
        if (phase.id === "H") return { ...phase, closedAt: CLOSED_H, closedBy: { track: "main", agent: "lead" }, summary: "Nothing was left.", commit: "beef123" };
        return phase;
      }),
    },
    result: undefined,
  }));
}

export async function finishedWork(): Promise<Finished> {
  const { repo, root } = await makeTracked();
  for (const [id, goal] of [["G", "Ship exports."], ["H", "Retire the old reader."], ["K", "Later work."]] as const) await addPhase(repo, OPERATOR, { id, name: `${id} phase`, goal, weight: 1 });
  await closePhases(repo);
  const commits = { reader: await commitAt(root, "reader.txt", READER_COMMITTED), writer: await commitAt(root, "writer.txt", "2026-11-11T08:00:00.000Z"), csv: await commitAt(root, "csv.txt", CSV_COMMITTED) };
  const baseline = await sh(root, ["rev-parse", "--short=7", `${commits.reader}~1`]);
  await new Records(repo).writeLedger({
    schema: 1,
    baseline,
    other: [],
    milestones: [
      milestone("B2", "B", [landed("1 reader", commits.reader, { deferred: [{ what: "the manual" }] }), landed("2 writer", commits.writer, { landedAt: WRITER_RECORDED }), planned("3 index")]),
      milestone("B3", "B", [planned("4 later")]),
      milestone("B4", "B", [landed("9 lost", "fff0000"), landed("8 gone", "eee0000")]),
      milestone("B5", "B", [], { built: "aaa1111..bbb2222" }),
      milestone("G1", "G", [landed("1 csv", commits.csv, { deferred: [{ what: "the docs", to: "B2:3 index" }, { what: "the cache", parked: { why: "not needed yet" } }, { what: "the index", to: "B2:2 writer" }] })]),
      milestone("K1", "K", [planned("1 someday")]),
    ],
  });
  return { repo: await openRepo(root), root, commits };
}
