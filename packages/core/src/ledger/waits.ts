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

function freedFrom(task: Task, ref: string): Task {
  const { waitsOn = [], ...rest } = task;
  const kept = waitsOn.filter((wait) => wait.task !== ref);
  return kept.length === 0 ? rest : { ...rest, waitsOn: kept };
}

export function stopWaitingOn(ledger: Ledger, ref: string): { ledger: Ledger; freed: string[] } {
  const freed = ledger.milestones.flatMap((milestone) => milestone.tasks.filter((task) => waitsOnIt(task, ref)).map((task) => `${milestone.id} '${task.id}'`));
  if (freed.length === 0) return { ledger, freed };
  const milestones = ledger.milestones.map((milestone) => ({ ...milestone, tasks: milestone.tasks.map((task) => (waitsOnIt(task, ref) ? freedFrom(task, ref) : task)) }));
  return { ledger: { ...ledger, milestones }, freed };
}

export function withDeferred(task: Task, deferred: readonly Deferred[] | undefined): Task {
  if (deferred === undefined) return task;
  for (const part of deferred) {
    if (part.to !== undefined) parseRef(part.to, "a deferred part's to");
  }
  const { deferred: _held, ...rest } = task;
  return deferred.length === 0 ? rest : { ...rest, deferred: deferred.map((part) => ({ ...part })) };
}
