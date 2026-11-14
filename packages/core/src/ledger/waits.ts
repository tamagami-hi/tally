import { TallyError } from "../errors.ts";
import type { Deferred, Ledger, Task, WaitOn } from "../schema/ledger.ts";
import { parseRef, refOf, taskAt } from "./refs.ts";

export function describeWait(wait: WaitOn): string {
  const named = wait.task ?? wait.note;
  if (named === undefined) return wait.what;
  return wait.what === "" ? named : `${named} (${wait.what})`;
}

export function waitsOf(task: Task): string[] {
  return [...(task.waits === undefined ? [] : [task.waits]), ...(task.waitsOn ?? []).map(describeWait)];
}

export function withoutWaits(task: Task): Task {
  const { waits: _waits, waitsOn: _waitsOn, ...rest } = task;
  return rest;
}

export function waitingOn(ledger: Ledger, milestone: string, task: Task, on: string, what: string): Task {
  const named = parseRef(on, "on");
  if (on === refOf(milestone, task.id)) throw new TallyError(`'${task.id}' in ${milestone} cannot wait on itself`);
  const target = taskAt(ledger, on);
  if (target?.status === "landed") throw new TallyError(`'${named.task}' in ${named.milestone} landed at ${target.commit ?? "?"}, so there is nothing to wait for`);
  return { ...task, waitsOn: [...(task.waitsOn ?? []).filter((wait) => wait.task !== on), { task: on, what }] };
}

const waitsOnIt = (task: Task, ref: string): boolean => (task.waitsOn ?? []).some((wait) => wait.task === ref);

export interface Waiter {
  label: string;
  track: string;
}

export function waitersOn(ledger: Ledger, ref: string): Waiter[] {
  return ledger.milestones.flatMap((milestone) => milestone.tasks.filter((task) => waitsOnIt(task, ref)).map((task) => ({ label: `${milestone.id} '${task.id}'`, track: task.track })));
}

function freedFrom(task: Task, ref: string): Task {
  const { waitsOn = [], ...rest } = task;
  const kept = waitsOn.filter((wait) => wait.task !== ref);
  return kept.length === 0 ? rest : { ...rest, waitsOn: kept };
}

export function stopWaitingOn(ledger: Ledger, ref: string): { ledger: Ledger; freed: string[] } {
  const freed = waitersOn(ledger, ref).map((waiter) => waiter.label);
  if (freed.length === 0) return { ledger, freed };
  const milestones = ledger.milestones.map((milestone) => ({ ...milestone, tasks: milestone.tasks.map((task) => (waitsOnIt(task, ref) ? freedFrom(task, ref) : task)) }));
  return { ledger: { ...ledger, milestones }, freed };
}

export const MOST_PARKED_WHY = 200;
export const MOST_OWNER = 60;

function assertShort(text: string | undefined, most: number, what: string): void {
  if (text !== undefined && text.length > most) throw new TallyError(`a parked part's ${what} holds at most ${most} characters; this one has ${text.length}`);
}

export function assertDeferred(deferred: readonly Deferred[]): void {
  for (const part of deferred) {
    if (part.to !== undefined && part.parked !== undefined) throw new TallyError(`a part is left to a task or parked, not both: '${part.what}'`);
    if (part.to !== undefined) parseRef(part.to, "a deferred part's to");
    assertShort(part.parked?.why, MOST_PARKED_WHY, "why");
    assertShort(part.parked?.owner, MOST_OWNER, "owner");
  }
}

export const copyPart = (part: Deferred): Deferred => (part.parked === undefined ? { ...part } : { ...part, parked: { ...part.parked } });

export function withDeferred(task: Task, deferred: readonly Deferred[] | undefined): Task {
  if (deferred === undefined) return task;
  assertDeferred(deferred);
  const { deferred: _held, ...rest } = task;
  return deferred.length === 0 ? rest : { ...rest, deferred: deferred.map(copyPart) };
}
