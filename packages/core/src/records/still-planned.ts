import { join } from "node:path";
import { cycleDir, readCycles } from "../cycles/file.ts";
import { TallyError } from "../errors.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import { ledgerSchema } from "../schema/ledger.ts";
import { readJson, tolerated } from "../store/json.ts";
import { Records, type Repo } from "../store/records.ts";
import { isPresent } from "../tracks/file.ts";

export class ArchivedMilestone extends TallyError {
  constructor(milestone: string, cycle: number) {
    super(`${milestone} was archived with cycle ${cycle}, so nothing more is recorded against it; record against a milestone of the current cycle`);
    this.name = "ArchivedMilestone";
  }
}

async function archivedWith(repo: Repo, milestone: string): Promise<number | undefined> {
  const closed = (await tolerated(readCycles(repo.recordsDir), { schema: 1, current: 1, cycles: [] })).value.cycles.map((one) => one.n).sort((a, b) => b - a);
  for (const n of closed) {
    const path = join(cycleDir(repo.recordsDir, n), "ledger.json");
    const ledger = (await isPresent(path)) ? (await tolerated(readJson(path, ledgerSchema), undefined)).value : undefined;
    if (ledger?.milestones.some((one) => one.id === milestone) === true) return n;
  }
  return undefined;
}

export async function assertStillPlanned(repo: Repo, milestone: string, task: string): Promise<void> {
  const ledger = await new Records(repo).readLedger();
  const found = ledger.milestones.find((one) => one.id === milestone);
  if (found === undefined) {
    const cycle = await archivedWith(repo, milestone);
    if (cycle !== undefined) throw new ArchivedMilestone(milestone, cycle);
    findMilestone(ledger, milestone);
    return;
  }
  if (findTask(found, task) === undefined) throw new TallyError(`'${task}' is not planned in ${milestone}`);
}

export async function refuseArchived(repo: Repo, milestone: string): Promise<void> {
  const ledger = await new Records(repo).readLedger();
  if (ledger.milestones.some((one) => one.id === milestone)) return;
  const cycle = await archivedWith(repo, milestone);
  if (cycle !== undefined) throw new ArchivedMilestone(milestone, cycle);
}
