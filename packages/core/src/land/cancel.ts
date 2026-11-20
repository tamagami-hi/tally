import { rename, writeFile } from "node:fs/promises";
import { TallyError } from "../errors.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { undoCommit } from "./clean.ts";
import { statePath } from "./paths.ts";
import { cancelTicket, findTicket, swapTicket, type Ticket } from "./queue.ts";
import { ownerFile } from "./turn.ts";

export const CANCELLED = "cancelled";

async function stopTheScript(ticket: Ticket): Promise<void> {
  const owner = ownerFile(ticket);
  await writeFile(`${owner}.tmp`, `${CANCELLED}\n`);
  await rename(`${owner}.tmp`, owner);
}

async function undone(ticket: Ticket): Promise<string> {
  const made = ticket.committed;
  if (made === undefined || made.tip === made.before || ticket.message === undefined) return "";
  return `; ${await undoCommit(ticket.worktree, made.before, made.tip)}`;
}

async function cancelAtTurn(repo: Repo, session: Session, id: string, now: Date): Promise<Ticket> {
  const { ticket } = await findTicket(repo, id);
  if (ticket.state === "landed") throw new TallyError(`ticket ${id} is landed: main has its commits, so it cannot be cancelled`);
  if (ticket.state !== "turn") return cancelTicket(repo, session, id, now);
  await stopTheScript(ticket);
  const { turn: _turn, ...rest } = ticket;
  const cancelled: Ticket = { ...rest, state: "cancelled", endedAt: now.toISOString(), note: `cancelled at its turn by ${session.agent}${await undone(ticket)}` };
  const { ticket: after, swapped } = await swapTicket(repo, ticket, cancelled);
  if (!swapped) throw new TallyError(`ticket ${id} changed while it was cancelled; it is ${after.state}`);
  return after;
}

export async function cancelLanding(repo: Repo, session: Session, id: string, now = new Date()): Promise<Ticket> {
  const { ticket } = await findTicket(repo, id);
  if (ticket.sessionId !== session.id && !isOperator(repo, session)) throw new TallyError(`ticket ${id} belongs to another session`);
  if (ticket.state === "queued") return cancelTicket(repo, session, id, now);
  return withLock(statePath(repo, "locks", "landing.lock"), () => cancelAtTurn(repo, session, id, now));
}
