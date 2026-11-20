import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { ledgerSchema } from "../schema/ledger.ts";
import { readJson } from "../store/json.ts";
import type { Repo } from "../store/records.ts";
import { isPresent } from "../tracks/file.ts";
import { cycleDir, readCycles } from "./file.ts";

export async function assertNewMilestone(repo: Repo, id: string): Promise<void> {
  for (const { n } of (await readCycles(repo.recordsDir)).cycles) {
    const path = join(cycleDir(repo.recordsDir, n), "ledger.json");
    if (!(await isPresent(path))) continue;
    if ((await readJson(path, ledgerSchema)).milestones.some((milestone) => milestone.id === id)) throw new TallyError(`milestone ${id} was in cycle ${n}; an id is never used again, so pick another`);
  }
}
