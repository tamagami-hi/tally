import { TallyError } from "../errors.ts";
import type { Ledger, Task } from "../schema/ledger.ts";
import { uncovered } from "./gaps.ts";
import { findMilestone, findTask, replaceMilestone } from "./items.ts";
import type { Changed } from "./ops.ts";
import { refOf } from "./refs.ts";
import { waitersOn, type Waiter } from "./waits.ts";

export interface RemoveInput {
  milestone: string;
  task: string;
  why: string;
}

export interface Removed extends Changed {
  removed: Task;
  waiters: Waiter[];
}

function deferredTo(ledger: Ledger, ref: string, except: Task): string[] {
  return ledger.milestones.flatMap((milestone) =>
    milestone.tasks.filter((task) => task !== except && (task.deferred ?? []).some((part) => part.to === ref)).map((task) => `${milestone.id} '${task.id}'`));
}

export function remove(ledger: Ledger, input: RemoveInput): Removed {
  const milestone = findMilestone(ledger, input.milestone);
  const found = findTask(milestone, input.task);
  if (found === undefined) throw new TallyError(`'${input.task}' is not planned in ${input.milestone}`);
  if (found.status === "landed" || found.commit !== undefined) {
    throw new TallyError(`'${found.id}' in ${input.milestone} landed at ${found.commit ?? "a commit"}: a landed task is the record of its commit and stays`);
  }
  const why = input.why.trim();
  if (why === "") throw new TallyError(`say why '${found.id}' is removed: the reason goes in the record's commit`);
  const ref = refOf(input.milestone, found.id);
  const kept = { ...milestone, tasks: milestone.tasks.filter((task) => task !== found) };
  const owedBefore = new Set(uncovered(milestone).map((deliverable) => deliverable.id));
  const owedNow = uncovered(kept).map((deliverable) => deliverable.id).filter((id) => !owedBefore.has(id));
  const waiters = waitersOn(ledger, ref);
  const unfinished = deferredTo(ledger, ref, found);
  const left = [
    ...(owedNow.length === 0 ? [] : [`no task covers ${owedNow.join(", ")} now`]),
    ...(waiters.length === 0 ? [] : [`still waiting on it: ${waiters.map((waiter) => waiter.label).join(", ")}`]),
    ...(unfinished.length === 0 ? [] : [`a part deferred to it has no task to finish it now: ${unfinished.join(", ")}`]),
  ];
  return {
    ledger: replaceMilestone(ledger, kept),
    message: [`${input.milestone} '${found.id}': removed (${why})`, ...left].join("; "),
    removed: found,
    waiters,
  };
}
