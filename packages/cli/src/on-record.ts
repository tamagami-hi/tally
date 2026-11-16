import { CLI_SESSION, flushWhenFree, keepsContextAsRecords, listSessions, logActivity, messageOf, type Repo } from "@tally/core";
import type { IO } from "./io.ts";

export interface Written {
  verb: string;
  target: string;
  by?: string | undefined;
}

export async function onRecord(repo: Repo, io: IO, written: Written): Promise<void> {
  if (!keepsContextAsRecords(repo.config)) return;
  try {
    await logActivity(repo, { session: CLI_SESSION, track: repo.config.mainBranch, agent: written.by ?? CLI_SESSION, verb: written.verb, target: written.target });
  } catch (error: unknown) {
    io.err(`the activity log was not written: ${messageOf(error)}`);
    return;
  }
  try {
    if ((await listSessions(repo)).length === 0) await flushWhenFree(repo);
  } catch (error: unknown) {
    io.err(`the activity event was written and waits on disk, not committed: ${messageOf(error)}`);
  }
}
