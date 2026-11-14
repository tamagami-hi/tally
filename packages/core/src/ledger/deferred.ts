import { TallyError } from "../errors.ts";
import { readDecisions } from "../records/decisions.ts";
import type { Deferred, Ledger, Parked, Task } from "../schema/ledger.ts";
import { assertMayWrite, isOperator, type Session } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import { findMilestone, findTask, replaceMilestone } from "./items.ts";
import { taskAt, type Milestones } from "./refs.ts";
import { assertDeferred, copyPart } from "./waits.ts";

export const deferredStates = ["unplaced", "waiting", "done", "parked"] as const;
export type DeferredState = (typeof deferredStates)[number];
export type DeferredCounts = Record<DeferredState, number>;

export interface DeferredRow {
  milestone: string;
  task: string;
  track: string;
  part: number;
  what: string;
  state: DeferredState;
  to?: string;
  parked?: Parked;
}

export interface DeferredFilter {
  state?: DeferredState | undefined;
  milestone?: string | undefined;
  track?: string | undefined;
  decision?: string | undefined;
  owner?: string | undefined;
}

export interface PlaceInput {
  milestone: string;
  task: string;
  part: number;
  to?: string | undefined;
  parked?: Parked | undefined;
}

export interface Placed {
  before: Deferred;
  after: Deferred;
  message: string;
}

export function partState(ledger: Milestones, part: Deferred): DeferredState {
  if (part.parked !== undefined) return "parked";
  if (part.to === undefined) return "unplaced";
  return taskAt(ledger, part.to)?.status === "landed" ? "done" : "waiting";
}

export function deferredRows(ledger: Ledger): DeferredRow[] {
  return ledger.milestones.flatMap((milestone) => milestone.tasks.flatMap((task) => (task.deferred ?? []).map((part, index): DeferredRow => ({
    milestone: milestone.id,
    task: task.id,
    track: task.track,
    part: index + 1,
    what: part.what,
    state: partState(ledger, part),
    ...(part.to === undefined ? {} : { to: part.to }),
    ...(part.parked === undefined ? {} : { parked: { ...part.parked } }),
  }))));
}

export function countParts(rows: readonly DeferredRow[]): DeferredCounts {
  return Object.fromEntries(deferredStates.map((state) => [state, rows.filter((row) => row.state === state).length])) as DeferredCounts;
}

export function matchingRows(rows: readonly DeferredRow[], filter: DeferredFilter): DeferredRow[] {
  return rows.filter((row) =>
    (filter.state === undefined || row.state === filter.state)
    && (filter.milestone === undefined || row.milestone === filter.milestone)
    && (filter.track === undefined || row.track === filter.track)
    && (filter.decision === undefined || row.parked?.decision === filter.decision)
    && (filter.owner === undefined || row.parked?.owner === filter.owner));
}

export async function assertMayPark(repo: Repo, session: Pick<Session, "track">, parts: readonly Deferred[]): Promise<void> {
  const parked = parts.flatMap((part) => (part.parked === undefined ? [] : [part.parked]));
  if (parked.length === 0) return;
  if (!isOperator(repo, session) && parked.some((one) => one.decision === undefined)) throw new TallyError("an operator session parks a part; or name the decision that covers it");
  const named = parked.flatMap((one) => (one.decision === undefined ? [] : [one.decision]));
  if (named.length === 0) return;
  const known = new Set((await readDecisions(repo)).decisions.map((decision) => decision.id));
  const unknown = named.find((id) => !known.has(id));
  if (unknown !== undefined) throw new TallyError(`no decision ${unknown}; decision_list shows the decisions`);
}

function placement(input: PlaceInput, what: string): Deferred {
  if (input.to === undefined && input.parked === undefined) throw new TallyError("give the part a task to finish it (to) or park it (parked)");
  const placed: Deferred = { what, ...(input.to === undefined ? {} : { to: input.to }), ...(input.parked === undefined ? {} : { parked: { ...input.parked } }) };
  assertDeferred([placed]);
  return placed;
}

const SHOWN = "deferred_list shows the parts there are";

function plannedTask(ledger: Ledger, milestone: string, id: string): Task {
  const task = findTask(findMilestone(ledger, milestone), id);
  if (task === undefined) throw new TallyError(`'${id}' is not planned in ${milestone}; ${SHOWN}`);
  return task;
}

function partOf(milestone: string, task: Task, part: number): Deferred {
  const parts = task.deferred ?? [];
  if (parts.length === 0) throw new TallyError(`${milestone} '${task.id}' has no deferred parts; ${SHOWN}`);
  const found = Number.isInteger(part) ? parts[part - 1] : undefined;
  if (found === undefined) throw new TallyError(`${milestone} '${task.id}' has ${parts.length} deferred part${parts.length === 1 ? "" : "s"}; part is a number from 1 to ${parts.length}, as deferred_list shows it`);
  return found;
}

const said = (part: Deferred): string => (part.parked === undefined ? `left to ${part.to ?? "no task"}` : `parked${part.parked.decision === undefined ? "" : `, under ${part.parked.decision}`}`);

export function placePart(ledger: Ledger, input: PlaceInput, read?: string): { ledger: Ledger; placed: Placed } {
  const milestone = findMilestone(ledger, input.milestone);
  const task = plannedTask(ledger, input.milestone, input.task);
  const before = partOf(milestone.id, task, input.part);
  if (read !== undefined && before.what !== read) throw new TallyError(`part ${input.part} of ${milestone.id} '${task.id}' is now '${before.what}', not '${read}': the parts changed meanwhile; read deferred_list again`);
  const after = placement(input, before.what);
  const deferred = (task.deferred ?? []).map((part, index) => (index === input.part - 1 ? after : copyPart(part)));
  const tasks = milestone.tasks.map((one) => (one === task ? { ...task, deferred } : one));
  const message = `${milestone.id} '${task.id}': part ${input.part} (${before.what}) ${said(after)}`;
  return { ledger: replaceMilestone(ledger, { ...milestone, tasks }), placed: { before: copyPart(before), after, message } };
}

export async function setDeferred(repo: Repo, session: Session, input: PlaceInput): Promise<Placed> {
  const records = new Records(repo);
  const task = plannedTask(await records.readLedger(), input.milestone, input.task);
  const seen = partOf(input.milestone, task, input.part);
  const after = placement(input, seen.what);
  assertMayWrite(repo, session, task.track);
  await assertMayPark(repo, session, [after]);
  let placed: Placed | undefined;
  await records.update((ledger) => {
    const done = placePart(ledger, input, seen.what);
    placed = done.placed;
    return { ledger: done.ledger, message: done.placed.message };
  });
  if (placed === undefined) throw new TallyError(`${input.milestone} '${input.task}': the part was not placed`);
  return placed;
}
