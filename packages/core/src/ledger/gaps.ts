import type { Deferred, Deliverable, Ledger, Milestone, Task } from "../schema/ledger.ts";
import { isOwnedBy } from "./items.ts";
import { taskAt, type Milestones } from "./refs.ts";

export interface Gap {
  milestone: string;
  task?: string;
  track?: string;
  text: string;
}

const NOT_THERE = "which is not a task in the ledger";

export function uncovered(milestone: Pick<Milestone, "delivers" | "tasks">): Deliverable[] {
  const covered = new Set(milestone.tasks.flatMap((task) => task.covers ?? []));
  return (milestone.delivers ?? []).filter((one) => one.dropped === undefined && !covered.has(one.id));
}

export function unfinished(ledger: Milestones, task: Task): Deferred[] {
  if (task.status !== "landed") return [];
  return (task.deferred ?? []).filter((part) => part.parked === undefined && (part.to === undefined || taskAt(ledger, part.to)?.status !== "landed"));
}

function waitGaps(ledger: Milestones, name: string, task: Task): string[] {
  return (task.waitsOn ?? []).flatMap(({ task: on }) =>
    on === undefined || taskAt(ledger, on) !== undefined ? [] : [`${name} waits on ${on}, ${NOT_THERE}: plan it with task_plan, or clear the wait with task_unwait`]);
}

function deferredGaps(ledger: Milestones, name: string, task: Task): string[] {
  return (task.deferred ?? []).flatMap(({ what, to, parked }) => {
    if (parked !== undefined) return [];
    if (to === undefined) return [`${name} landed without '${what}' and names no task to finish it: leave it to a task, or park it, with deferred_set`];
    return taskAt(ledger, to) === undefined ? [`${name} left '${what}' to ${to}, ${NOT_THERE}: plan it with task_plan`] : [];
  });
}

function milestoneGaps(ledger: Milestones, milestone: Milestone): Gap[] {
  const owed = uncovered(milestone).map(({ id, what }): Gap => ({ milestone: milestone.id, text: `${milestone.id} delivers '${id}' (${what}), and no task covers it: plan a task that covers it with task_plan` }));
  const ofTasks = milestone.tasks.flatMap((task) => {
    const name = `${milestone.id} '${task.id}'`;
    return [...waitGaps(ledger, name, task), ...deferredGaps(ledger, name, task)].map((text): Gap => ({ milestone: milestone.id, task: task.id, track: task.track, text }));
  });
  return [...owed, ...ofTasks];
}

export function findGaps(ledger: Ledger): Gap[] {
  return ledger.milestones.flatMap((milestone) => milestoneGaps(ledger, milestone));
}

export function gapsOf(ledger: Ledger, track: string): Gap[] {
  const owned = new Set(ledger.milestones.filter((milestone) => isOwnedBy(milestone, track)).map((milestone) => milestone.id));
  return findGaps(ledger).filter((gap) => (gap.track === undefined ? owned.has(gap.milestone) : gap.track === track));
}
