import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { commitHeld, landingLockPath, recordsMode } from "../records/commit.ts";
import { readJson } from "../store/json.ts";
import { LockBusy, QUICK_RETRIES, RETRIES, withLock, withLocks, type Retries } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { isPresent } from "../tracks/file.ts";
import { carryOut, lockPaths } from "./carry.ts";
import { CYCLES_DIR, closingPath } from "./file.ts";
import { planSchema, type ClosePlan } from "./plan.ts";

export const CLOSE_BUSY = "a cycle close is being finished: try again in a moment; until it is, a tool that writes is refused";

export class CloseBusy extends TallyError {
  constructor() {
    super(CLOSE_BUSY);
    this.name = "CloseBusy";
  }
}

const CYCLE_FOLDER = /^cycle-(\d+)$/;

async function cycleFolders(recordsDir: string): Promise<number[]> {
  try {
    return (await readdir(join(recordsDir, CYCLES_DIR))).flatMap((name) => {
      const n = CYCLE_FOLDER.exec(name)?.[1];
      return n === undefined ? [] : [Number(n)];
    });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function pendingNumber(recordsDir: string): Promise<number | undefined> {
  const newest = Math.max(0, ...(await cycleFolders(recordsDir)));
  return newest > 0 && (await isPresent(closingPath(recordsDir, newest))) ? newest : undefined;
}

async function pendingPlan(recordsDir: string): Promise<ClosePlan | undefined> {
  const n = await pendingNumber(recordsDir);
  return n === undefined ? undefined : readJson(closingPath(recordsDir, n), planSchema);
}

export async function committed(repo: Repo, n: number, summary: string): Promise<string | null> {
  if (recordsMode(repo.config) === "never") return null;
  return (await commitHeld(repo, () => `cycle ${n} closed`, summary)).commit;
}

export async function finishHeld(repo: Repo, retries: Retries = RETRIES): Promise<string | null | undefined> {
  const plan = await pendingPlan(repo.recordsDir);
  if (plan === undefined) return undefined;
  await withLocks(lockPaths(repo, plan), async () => {
    await carryOut(repo, plan);
    await rm(closingPath(repo.recordsDir, plan.n), { force: true });
  }, retries);
  return committed(repo, plan.n, plan.record.summary);
}

export class CloseUnfinished extends TallyError {
  readonly cycle: number;
  readonly reason: string;

  constructor(cycle: number, reason: string) {
    super(`a cycle close is being finished and could not be finished now: ${reason}; try again, and tell the operator if it fails again`);
    this.name = "CloseUnfinished";
    this.cycle = cycle;
    this.reason = reason;
  }
}

const unfinished = (n: number, error: unknown): TallyError => (error instanceof LockBusy ? new CloseBusy() : new CloseUnfinished(n, messageOf(error)));

export async function finishPendingClose(repo: Repo, retries: Retries = QUICK_RETRIES): Promise<string | null | undefined> {
  if (repo.cycle !== undefined) return undefined;
  const n = await pendingNumber(repo.recordsDir);
  if (n === undefined) return undefined;
  try {
    return await withLock(landingLockPath(repo), () => finishHeld(repo, retries), retries);
  } catch (error: unknown) {
    throw unfinished(n, error);
  }
}
