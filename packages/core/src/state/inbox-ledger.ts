import { logLines } from "../git/refs.ts";
import { queueFile, type Ticket } from "../land/queue.ts";
import { unrecorded } from "../ledger/check.ts";
import { SHORT } from "../ledger/items.ts";
import { Records, type Repo } from "../store/records.ts";
import { listSessions, type Session } from "./sessions.ts";

const MOST_NAMED = 5;

export interface Standing {
  someoneIsOnMain: boolean;
  tickets: readonly Ticket[];
}

export interface LedgerNews {
  lines: string[];
  told: string[];
  checked: string;
}

export const hashOf = (line: string): string => (line.split(" ", 1)[0] ?? line).slice(0, SHORT);

export const isSameCommit = (a: string, b: string): boolean => a.slice(0, SHORT) === b.slice(0, SHORT);

const commitsOf = (ticket: Ticket): readonly string[] => ticket.landed?.commits ?? ticket.turn?.commits ?? [];

const isSettled = (ticket: Ticket): boolean => ticket.landed !== undefined && (ticket.target === undefined || ticket.landed.recording !== undefined);

export async function standingOf(repo: Repo): Promise<Standing> {
  const main = repo.config.mainBranch;
  return { someoneIsOnMain: (await listSessions(repo)).some((open) => open.track === main), tickets: (await queueFile(repo).read()).tickets };
}

export function markOf(main: string | undefined, standing: Standing): string {
  return [main ?? "", standing.someoneIsOnMain ? "on-main" : "none-on-main", standing.tickets.filter(isSettled).length].join("|");
}

export async function unrecordedFor(repo: Repo, session: Session, standing: Standing): Promise<string[]> {
  const main = repo.config.mainBranch;
  const ledger = await new Records(repo).readLedger();
  const missing = unrecorded(ledger, await logLines(repo.root, `${ledger.baseline}..${main}`), repo.config.records.commitPrefix);
  return missing.filter((line) => {
    const landing = standing.tickets.find((ticket) => commitsOf(ticket).some((commit) => isSameCommit(commit, hashOf(line))));
    if (landing === undefined) return session.track === main || !standing.someoneIsOnMain;
    return isSettled(landing) && landing.track === session.track;
  });
}

export async function ledgerNewsFor(repo: Repo, session: Session, main: string | undefined, before: { checked?: string | undefined; told?: readonly string[] | undefined }): Promise<LedgerNews> {
  const unchanged: LedgerNews = { lines: [], told: [...(before.told ?? [])], checked: before.checked ?? "" };
  try {
    const standing = await standingOf(repo);
    const mark = markOf(main, standing);
    if (mark === before.checked) return unchanged;
    const now = await unrecordedFor(repo, session, standing);
    const alreadyTold = new Set(before.told ?? []);
    return { lines: now.filter((line) => !alreadyTold.has(hashOf(line))), told: now.map(hashOf), checked: mark };
  } catch {
    return unchanged;
  }
}

export async function unrecordedNow(repo: Repo, session: Session): Promise<string[]> {
  try {
    return await unrecordedFor(repo, session, await standingOf(repo));
  } catch {
    return [];
  }
}

export function unrecordedText(lines: readonly string[]): string {
  const count = lines.length;
  const more = count > MOST_NAMED ? `, and ${count - MOST_NAMED} more, which ledger_check lists` : "";
  const each = count === 1 ? "it" : "each";
  return `main has ${count} commit${count === 1 ? "" : "s"} the ledger does not record: ${lines.slice(0, MOST_NAMED).join("; ")}${more}. Record ${each} with task_land if it is a task's commit, or with task_other and a note if it is not.`;
}
