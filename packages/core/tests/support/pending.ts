import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { carryOut } from "../../src/cycles/carry.ts";
import { closingPath, cycleDir } from "../../src/cycles/file.ts";
import { planClose, type ClosePlan } from "../../src/cycles/plan.ts";
import type { Ledger } from "../../src/schema/ledger.ts";
import { writeJsonAtomic } from "../../src/store/json.ts";
import { withLock } from "../../src/store/lock.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { closeOpened } from "../../src/tracks/close.ts";
import { isPresent } from "../../src/tracks/file.ts";
import { AT, type Cycling } from "./cycling.ts";

export const BY = { track: "main", agent: "operator" };
export const CLOSE_INPUT = { summary: "the reader is built", said: "close it" };
export const OPERATIONS = 16;
export const SOON = { retries: 2, minTimeout: 20, maxTimeout: 40 };

export async function pendingClose(made: Pick<Cycling, "repo">, steps = 0): Promise<ClosePlan> {
  await closeOpened(made.repo, "docs", { by: BY, now: AT, why: "cycle 1 closed", commit: false });
  const plan = await planClose(made.repo, await new Records(made.repo).readLedger(), { by: BY, now: AT, input: CLOSE_INPUT });
  await writeJsonAtomic(closingPath(made.repo.recordsDir, 1), plan);
  await carryOut(made.repo, plan, steps);
  return plan;
}

export const isPending = (repo: Repo): Promise<boolean> => isPresent(closingPath(repo.recordsDir, 1));

export interface Held {
  release: () => Promise<void>;
}

export async function holding(path: string): Promise<Held> {
  let free: () => void = () => undefined;
  let taken: () => void = () => undefined;
  const gate = new Promise<void>((done) => { free = done; });
  const inside = new Promise<void>((done) => { taken = done; });
  const held = withLock(path, async () => { taken(); await gate; });
  await inside;
  return { release: async () => { free(); await held; } };
}

type Raw = Record<string, unknown>;

const rawAt = async (path: string): Promise<Raw | undefined> => (await isPresent(path) ? (JSON.parse(await readFile(path, "utf8")) as Raw) : undefined);

export interface BothFolders {
  current: Raw | undefined;
  cycle: Raw | undefined;
}

export const bothFolders = async (repo: Repo, file: string): Promise<BothFolders> => ({ current: await rawAt(join(repo.recordsDir, file)), cycle: await rawAt(join(cycleDir(repo.recordsDir, 1), file)) });

export const listOf = <T>(file: Raw | undefined, key: string): T[] => ((file?.[key] ?? []) as T[]);

export const withTask = (ledger: Ledger, milestone: string, task: string): Ledger => ({
  ...ledger,
  milestones: ledger.milestones.map((one) => (one.id === milestone ? { ...one, tasks: [...one.tasks, { id: task, track: "eng", status: "planned" as const, also: [] }] } : one)),
});

export const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
