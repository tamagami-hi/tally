import { TallyError, flushRecords, type Repo } from "@tally/core";
import type { IO } from "../io.ts";

export async function recordsCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb] = argv;
  if (verb !== "commit") throw new TallyError(`tally records: unknown verb '${verb ?? ""}'; use commit`, 2);
  const sha = await flushRecords(repo);
  io.out(sha === null ? "no records waiting" : `records: ${sha}`);
  return 0;
}
