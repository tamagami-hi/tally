import { COVERED, Records, TallyError, owedCommits, passedLine, type Repo } from "@tally/core";
import type { IO } from "../io.ts";

export async function ledgerCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb] = argv;
  if (verb !== "check") throw new TallyError(`tally ledger: unknown verb '${verb ?? ""}'; use check`, 2);
  const { missing, passed } = await owedCommits(repo, await new Records(repo).readLedger());
  const passedText = passedLine(passed.length, repo.config.records.dir);
  for (const line of missing.length === 0 ? [COVERED] : missing) io.out(line);
  if (passedText !== undefined) io.out(passedText);
  return missing.length === 0 ? 0 : 1;
}
