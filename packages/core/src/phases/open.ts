import { TallyError } from "../errors.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { isClosed, phaseRows } from "./rows.ts";

export async function assertStageOpen(repo: Repo, stage: string): Promise<void> {
  const row = (await phaseRows(repo)).find((one) => one.id === stage);
  if (row !== undefined && isClosed(row)) throw new TallyError(`phase ${stage} is closed; later work goes in a new phase (phase_add)`);
}

export async function assertMilestoneOpen(repo: Repo, ledger: Ledger, milestone: string): Promise<void> {
  const found = ledger.milestones.find((one) => one.id === milestone);
  if (found !== undefined) await assertStageOpen(repo, found.stage);
}
