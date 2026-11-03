import { COVERED, Records, TallyError, logLines, unrecorded, type Repo } from "@tally/core";
import type { IO } from "../io.ts";

export async function ledgerCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb] = argv;
  if (verb !== "check") throw new TallyError(`tally ledger: unknown verb '${verb ?? ""}'; use check`, 2);
  const ledger = await new Records(repo).readLedger();
  const missing = unrecorded(ledger, await logLines(repo.root, `${ledger.baseline}..${repo.config.mainBranch}`), repo.config.records.commitPrefix);
  if (missing.length === 0) {
    io.out(COVERED);
    return 0;
  }
  for (const line of missing) io.out(line);
  return 1;
}
