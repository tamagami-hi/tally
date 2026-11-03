import { TallyError } from "../errors.ts";
import type { Ledger, Task } from "../schema/ledger.ts";
import { addTask, findMilestone, findTask, keepCloseLast, replaceMilestone } from "./items.ts";

export type ResolveCommit = (commit: string) => Promise<string>;

export interface Changed {
  ledger: Ledger;
  message: string;
}

export interface PlanInput {
  milestone: string;
  track: string;
  tasks: readonly string[];
}

export interface LandInput {
  milestone: string;
  task: string;
  commit: string;
  track?: string;
  also?: readonly string[];
}

export interface WaitInput {
  milestone: string;
  task: string;
  what: string;
}

export interface OtherInput {
  commit: string;
  note: string;
}

const planned = (id: string, track: string): Task => ({ id, track, status: "planned", also: [] });

export function plan(ledger: Ledger, input: PlanInput): Changed & { added: string[] } {
  const milestone = findMilestone(ledger, input.milestone);
  if (milestone.built !== undefined) throw new TallyError(`${input.milestone} is already built`);
  const added: string[] = [];
  let tasks = milestone.tasks;
  for (const id of input.tasks) {
    if (findTask({ ...milestone, tasks }, id) === undefined) {
      tasks = addTask(tasks, planned(id, input.track));
      added.push(id);
    }
  }
  const listed = added.length > 0 ? `: ${added.join(", ")}` : "";
  return {
    ledger: replaceMilestone(ledger, { ...milestone, tasks: keepCloseLast(tasks) }),
    message: `${input.milestone}: planned ${added.length} new task(s)${listed}`,
    added,
  };
}

function withoutWait(task: Task): Task {
  const { waits: _waits, ...rest } = task;
  return rest;
}

export async function land(ledger: Ledger, input: LandInput, resolve: ResolveCommit): Promise<Changed> {
  const milestone = findMilestone(ledger, input.milestone);
  const commit = await resolve(input.commit);
  const also: string[] = [];
  for (const extra of input.also ?? []) also.push(await resolve(extra));
  const existing = findTask(milestone, input.task);
  let tasks = milestone.tasks;
  if (existing === undefined) {
    const track = input.track ?? (milestone.track.includes("+") ? undefined : milestone.track);
    if (track === undefined) throw new TallyError(`'${input.task}' is not planned in ${input.milestone}; give --track`);
    tasks = addTask(tasks, planned(input.task, track));
  }
  const landed = tasks.map((task): Task => {
    if (task.id !== input.task) return task;
    const merged = [...new Set([...task.also, ...also])].sort();
    return { ...withoutWait(task), status: "landed", commit, also: merged };
  });
  return {
    ledger: replaceMilestone(ledger, { ...milestone, tasks: landed }),
    message: `${input.milestone} '${input.task}': landed at ${commit}`,
  };
}

export function wait(ledger: Ledger, input: WaitInput): Changed {
  const milestone = findMilestone(ledger, input.milestone);
  if (findTask(milestone, input.task) === undefined) {
    throw new TallyError(`'${input.task}' is not planned in ${input.milestone}`);
  }
  const tasks = milestone.tasks.map((task) => (task.id === input.task ? { ...task, waits: input.what } : task));
  return {
    ledger: replaceMilestone(ledger, { ...milestone, tasks }),
    message: `${input.milestone} '${input.task}': waits for ${input.what}`,
  };
}

export async function other(ledger: Ledger, input: OtherInput, resolve: ResolveCommit): Promise<Changed> {
  const commit = await resolve(input.commit);
  const kept = ledger.other.filter((entry) => entry.commit !== commit);
  return {
    ledger: { ...ledger, other: [...kept, { commit, note: input.note }] },
    message: `${commit}: recorded as '${input.note}'`,
  };
}
