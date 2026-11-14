import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { assertMayPark } from "../ledger/deferred.ts";
import { reviewNote } from "../ledger/review-gaps.ts";
import { readReviews } from "../records/reviews.ts";
import { assertDeferred, copyPart } from "../ledger/waits.ts";
import { deferredSchema, type Deferred } from "../schema/ledger.ts";
import { StateFile } from "../state/file.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import type { Repo } from "../store/records.ts";
import { checkTrackPaths } from "./checks.ts";
import { branchChanges, checkCheckout } from "./operator.ts";
import { isDocumentation, statePath, trackOf, worktreeOf } from "./paths.ts";

export const ticketStates = ["queued", "turn", "landed", "failed", "cancelled"] as const;

const turnSchema = z.object({
  name: z.string(),
  startedAt: z.string(),
  base: z.string(),
  rebased: z.string(),
  commits: z.array(z.string()),
  script: z.string(),
  result: z.string(),
});

export const ticketSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  track: z.string().min(1),
  agent: z.string().min(1),
  worktree: z.string().min(1),
  files: z.array(z.string()),
  message: z.string().optional(),
  target: z.object({ milestone: z.string().min(1), task: z.string().min(1) }).optional(),
  verified: z.string().optional(),
  deferred: z.array(deferredSchema).optional(),
  state: z.enum(ticketStates),
  since: z.string(),
  attempts: z.number().int().nonnegative().default(0),
  committed: z.object({ before: z.string(), tip: z.string() }).optional(),
  turn: turnSchema.optional(),
  landed: z.object({ head: z.string(), commits: z.array(z.string()), recording: z.string().optional() }).optional(),
  note: z.string().optional(),
  problem: z.string().optional(),
  endedAt: z.string().optional(),
});

const queueSchema = z.object({ tickets: z.array(ticketSchema) });

export type Ticket = z.infer<typeof ticketSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type Queue = z.infer<typeof queueSchema>;

export interface JoinInput {
  files: readonly string[];
  message?: string;
  target?: { milestone: string; task: string };
  verified?: string;
  deferred?: readonly Deferred[] | undefined;
}

export interface TicketView {
  ticket: string;
  state: Ticket["state"];
  position: number | null;
  ahead: { track: string; agent: string; state: Ticket["state"]; since: string }[];
  run?: string;
  landed?: Ticket["landed"];
  note?: string;
  problem?: string;
}

const KEPT_FINISHED = 20;
const TICKET_LENGTH = 8;

export const isActive = (ticket: Ticket): boolean => ticket.state === "queued" || ticket.state === "turn";

export const queueFile = (repo: Pick<Repo, "stateDir">): StateFile<Queue> => new StateFile(statePath(repo, "queue.json"), queueSchema, () => ({ tickets: [] }));

export async function turnInProgress(repo: Pick<Repo, "stateDir">): Promise<boolean> {
  return (await queueFile(repo).read()).tickets.some((ticket) => ticket.state === "turn");
}

function trimmed(tickets: Ticket[]): Ticket[] {
  const finished = tickets.filter((ticket) => !isActive(ticket));
  const dropped = new Set(finished.slice(0, Math.max(0, finished.length - KEPT_FINISHED)).map((ticket) => ticket.id));
  return tickets.filter((ticket) => !dropped.has(ticket.id));
}

export async function putTicket(repo: Repo, next: Ticket): Promise<Ticket> {
  return queueFile(repo).update((queue) => ({ value: { tickets: trimmed(queue.tickets.map((ticket) => (ticket.id === next.id ? next : ticket))) }, result: next }));
}

export interface Swapped {
  ticket: Ticket;
  swapped: boolean;
}

export async function swapTicket(repo: Repo, read: Ticket, next: Ticket): Promise<Swapped> {
  return queueFile(repo).update((queue): { value: Queue; result: Swapped } => {
    const current = queue.tickets.find((ticket) => ticket.id === read.id);
    if (current === undefined || current.state !== read.state) return { value: queue, result: { ticket: current ?? read, swapped: false } };
    return { value: { tickets: trimmed(queue.tickets.map((ticket) => (ticket.id === next.id ? next : ticket))) }, result: { ticket: next, swapped: true } };
  });
}

export async function joinQueue(repo: Repo, session: Session, input: JoinInput, now = new Date()): Promise<Ticket> {
  const track = trackOf(repo.config, session.track);
  if ((input.message !== undefined) !== (input.files.length > 0)) throw new TallyError("a new commit needs both a message and explicit files");
  for (const name of input.files) {
    if (isAbsolute(name) || name.split("/").includes("..")) throw new TallyError(`file must be relative to the worktree: ${name}`);
  }
  checkTrackPaths(track, input.files);
  if (input.verified !== undefined && input.files.some((name) => !isDocumentation(name, repo.config))) throw new TallyError("--verified-code is only for documentation/evidence on already checked code");
  const deferred = input.deferred ?? [];
  if (deferred.length > 0 && input.target === undefined) throw new TallyError("deferred parts are recorded on a task: give the landing its milestone and task");
  assertDeferred(deferred);
  await assertMayPark(repo, session, deferred);
  await checkCheckout(repo, [...input.files, ...(await branchChanges(repo, track.branch))]);
  const note = input.target === undefined ? undefined : reviewNote((await readReviews(repo)).reviews, repo.config.reviews, input.target.milestone, input.target.task);
  const ticket: Ticket = {
    id: randomUUID().slice(0, TICKET_LENGTH),
    sessionId: session.id,
    track: session.track,
    agent: session.agent,
    worktree: session.worktree,
    files: [...input.files],
    ...(input.message === undefined ? {} : { message: input.message }),
    ...(input.target === undefined ? {} : { target: input.target }),
    ...(input.verified === undefined ? {} : { verified: input.verified }),
    ...(deferred.length === 0 ? {} : { deferred: deferred.map(copyPart) }),
    state: "queued",
    since: now.toISOString(),
    attempts: 0,
    ...(note === undefined ? {} : { note }),
  };
  return queueFile(repo).update((queue) => {
    const held = queue.tickets.find((other) => other.sessionId === session.id && isActive(other));
    if (held !== undefined) throw new TallyError(`this session already has ticket ${held.id} in the queue`);
    return { value: { tickets: [...queue.tickets, ticket] }, result: ticket };
  });
}

export function trackSession(repo: Repo, name: string, agent: string, now = new Date()): Session {
  const track = trackOf(repo.config, name);
  const stamp = now.toISOString();
  return { id: `${agent}-${name}`, track: name, worktree: worktreeOf(repo, track), branch: track.branch, agent, openedAt: stamp, lastSeenAt: stamp };
}

export async function findTicket(repo: Repo, id: string): Promise<{ ticket: Ticket; queue: Queue }> {
  const queue = await queueFile(repo).read();
  const ticket = queue.tickets.find((one) => one.id === id);
  if (ticket === undefined) throw new TallyError(`no ticket ${id}; a finished ticket is kept for the last ${KEPT_FINISHED} landings`);
  return { ticket, queue };
}

export async function cancelTicket(repo: Repo, session: Session, id: string, now = new Date()): Promise<Ticket> {
  return queueFile(repo).update((queue) => {
    const ticket = queue.tickets.find((one) => one.id === id);
    if (ticket === undefined) throw new TallyError(`no ticket ${id}`);
    if (ticket.sessionId !== session.id && !isOperator(repo, session)) throw new TallyError(`ticket ${id} belongs to another session`);
    if (ticket.state !== "queued") throw new TallyError(`ticket ${id} is ${ticket.state}; only a ticket that has not had its turn can be cancelled`);
    const cancelled: Ticket = { ...ticket, state: "cancelled", endedAt: now.toISOString() };
    return { value: { tickets: queue.tickets.map((one) => (one.id === id ? cancelled : one)) }, result: cancelled };
  });
}

export async function ticketView(repo: Repo, id: string): Promise<TicketView> {
  const { ticket, queue } = await findTicket(repo, id);
  const active = queue.tickets.filter(isActive);
  const index = active.findIndex((one) => one.id === id);
  return {
    ticket: ticket.id,
    state: ticket.state,
    position: index === -1 ? null : index,
    ahead: index === -1 ? [] : active.slice(0, index).map((one) => ({ track: one.track, agent: one.agent, state: one.state, since: one.turn?.startedAt ?? one.since })),
    ...(ticket.state === "turn" && ticket.turn !== undefined ? { run: `sh ${ticket.turn.script}` } : {}),
    ...(ticket.landed === undefined ? {} : { landed: ticket.landed }),
    ...(ticket.note === undefined ? {} : { note: ticket.note }),
    ...(ticket.problem === undefined ? {} : { problem: ticket.problem }),
  };
}
