import { logLines } from "../git/refs.ts";
import { queueFile } from "../land/queue.ts";
import { unrecorded } from "../ledger/check.ts";
import { Records, type Repo } from "../store/records.ts";
import { listSessions, type Session } from "./sessions.ts";

const MOST_NAMED = 5;

export const hashOf = (line: string): string => line.split(" ", 1)[0] ?? line;

export async function unrecordedFor(repo: Repo, session: Session): Promise<string[]> {
  const main = repo.config.mainBranch;
  const ledger = await new Records(repo).readLedger();
  const missing = unrecorded(ledger, await logLines(repo.root, `${ledger.baseline}..${main}`), repo.config.records.commitPrefix);
  if (missing.length === 0) return [];
  const landings = (await queueFile(repo).read()).tickets.filter((ticket) => ticket.landed !== undefined);
  const someoneIsOnMain = (await listSessions(repo)).some((open) => open.track === main);
  return missing.filter((line) => {
    const hash = hashOf(line);
    const landing = landings.find((ticket) => ticket.landed?.commits.some((commit) => commit.startsWith(hash)));
    if (landing === undefined) return session.track === main || !someoneIsOnMain;
    const isBeingRecorded = landing.target !== undefined && landing.landed?.recording === undefined;
    return !isBeingRecorded && landing.track === session.track;
  });
}

export function unrecordedText(lines: readonly string[]): string {
  const count = lines.length;
  const more = count > MOST_NAMED ? `, and ${count - MOST_NAMED} more, which ledger_check lists` : "";
  const each = count === 1 ? "it" : "each";
  return `main has ${count} commit${count === 1 ? "" : "s"} the ledger does not record: ${lines.slice(0, MOST_NAMED).join("; ")}${more}. Record ${each} with task_land if it is a task's commit, or with task_other and a note if it is not.`;
}
