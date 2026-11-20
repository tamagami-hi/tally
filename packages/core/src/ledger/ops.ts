import { TallyError } from "../errors.ts";
import type { Deferred, Deliverable, Ledger, Task } from "../schema/ledger.ts";
import { distinctDeliverables, hasDetails, withDetails, type PlannedTask } from "./details.ts";
import { addTask, findMilestone, findTask, keepCloseLast, replaceMilestone } from "./items.ts";
import { refOf } from "./refs.ts";
import { stopWaitingOn, waitingOn, waitsOf, withDeferred, withoutWaits } from "./waits.ts";

export type ResolveCommit = (commit: string) => Promise<string>;

export interface Changed {
  ledger: Ledger;
  message: string;
}

export interface PlanInput {
  milestone: string;
  track: string;
  tasks: readonly (string | PlannedTask)[];
}

export interface LandInput {
  milestone: string;
  task: string;
  commit: string;
  track?: string;
  also?: readonly string[];
  deferred?: readonly Deferred[] | undefined;
  at?: string | undefined;
  checked?: "tip" | undefined;
}

export interface WaitInput {
  milestone: string;
  task: string;
  what: string;
  on?: string | undefined;
}

export type UnwaitInput = Pick<WaitInput, "milestone" | "task">;

export interface OtherInput {
  commit: string;
  note: string;
}

export interface MilestoneInput {
  id: string;
  stage: string;
  name: string;
  track: string;
  weight: number;
  waits?: string;
  group?: string;
  delivers?: readonly Deliverable[] | undefined;
}

export interface DeliverInput {
  milestone: string;
  delivers: readonly Deliverable[];
}

const planned = (id: string, track: string): Task => ({ id, track, status: "planned", also: [] });

export function addMilestone(ledger: Ledger, input: MilestoneInput, stages: readonly string[]): Changed {
  if (ledger.milestones.some((milestone) => milestone.id === input.id)) throw new TallyError(`milestone ${input.id} already exists`);
  if (!stages.includes(input.stage)) throw new TallyError(`no stage '${input.stage}'; known: ${stages.join(", ")}`);
  if (!Number.isInteger(input.weight) || input.weight <= 0) throw new TallyError(`weight must be a positive integer, not ${input.weight}`);
  const delivers = distinctDeliverables(input.id, [], input.delivers ?? []);
  const milestone = {
    id: input.id,
    stage: input.stage,
    name: input.name,
    track: input.track,
    weight: input.weight,
    ...(input.waits === undefined ? {} : { waits: input.waits }),
    ...(input.group === undefined ? {} : { group: input.group }),
    ...(delivers.length === 0 ? {} : { delivers }),
    tasks: [],
  };
  return { ledger: { ...ledger, milestones: [...ledger.milestones, milestone] }, message: `${input.id}: added to stage ${input.stage}` };
}

export function deliver(ledger: Ledger, input: DeliverInput): Changed {
  const milestone = findMilestone(ledger, input.milestone);
  if (milestone.built !== undefined) throw new TallyError(`${input.milestone} is already built`);
  if (input.delivers.length === 0) throw new TallyError(`name at least one deliverable for ${input.milestone}`);
  const delivers = distinctDeliverables(input.milestone, milestone.delivers ?? [], input.delivers);
  return {
    ledger: replaceMilestone(ledger, { ...milestone, delivers }),
    message: `${input.milestone}: delivers ${input.delivers.length} more: ${input.delivers.map((one) => one.id).join(", ")}`,
  };
}

export function plan(ledger: Ledger, input: PlanInput): Changed & { added: string[]; updated: string[] } {
  const milestone = findMilestone(ledger, input.milestone);
  if (milestone.built !== undefined) throw new TallyError(`${input.milestone} is already built`);
  const added: string[] = [];
  const updated: string[] = [];
  let tasks = milestone.tasks;
  for (const entry of input.tasks) {
    const given: PlannedTask = typeof entry === "string" ? { id: entry } : entry;
    const held = findTask({ ...milestone, tasks }, given.id);
    if (held === undefined) {
      tasks = addTask(tasks, withDetails(milestone, planned(given.id, input.track), given));
      added.push(given.id);
    } else if (hasDetails(given)) {
      if (held.track !== input.track) throw new TallyError(`'${given.id}' in ${input.milestone} is track ${held.track}'s task, so track ${input.track} does not set its details`);
      tasks = tasks.map((task) => (task === held ? withDetails(milestone, task, given) : task));
      updated.push(given.id);
    }
  }
  const listed = added.length > 0 ? `: ${added.join(", ")}` : "";
  const detailed = updated.length > 0 ? `; set the details of ${updated.join(", ")}` : "";
  return {
    ledger: replaceMilestone(ledger, { ...milestone, tasks: keepCloseLast(tasks) }),
    message: `${input.milestone}: planned ${added.length} new task(s)${listed}${detailed}`,
    added,
    updated,
  };
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
    const at = task.status === "landed" ? task.landedAt : input.at;
    return withDeferred({ ...withoutWaits(task), status: "landed", commit, also: merged, ...(at === undefined ? {} : { landedAt: at }), ...(input.checked === undefined ? {} : { checked: input.checked }) }, input.deferred);
  });
  const parts = landed.find((task) => task.id === input.task)?.deferred ?? [];
  const parked = parts.filter((part) => part.parked !== undefined).length;
  const left = parts.length - parked;
  const stopped = stopWaitingOn(replaceMilestone(ledger, { ...milestone, tasks: landed }), refOf(input.milestone, input.task));
  const inPart = `${left === 0 ? "" : `, in part: ${left} deferred`}${parked === 0 ? "" : `, ${parked} parked`}`;
  const freed = stopped.freed.length === 0 ? "" : `; no longer waiting on it: ${stopped.freed.join(", ")}`;
  return {
    ledger: stopped.ledger,
    message: `${input.milestone} '${input.task}': landed at ${commit}${inPart}${freed}`,
  };
}

export function wait(ledger: Ledger, input: WaitInput): Changed {
  const milestone = findMilestone(ledger, input.milestone);
  const found = findTask(milestone, input.task);
  if (found === undefined) throw new TallyError(`'${input.task}' is not planned in ${input.milestone}`);
  const { on, what } = input;
  const waiting = on === undefined ? { ...found, waits: what } : waitingOn(ledger, input.milestone, found, on, what);
  const tasks = milestone.tasks.map((task) => (task === found ? waiting : task));
  return {
    ledger: replaceMilestone(ledger, { ...milestone, tasks }),
    message: `${input.milestone} '${input.task}': ${on === undefined ? `waits for ${what}` : `waits on ${on} for ${what}`}`,
  };
}

export function unwait(ledger: Ledger, input: UnwaitInput): Changed {
  const milestone = findMilestone(ledger, input.milestone);
  const found = findTask(milestone, input.task);
  if (found === undefined) throw new TallyError(`'${input.task}' is not planned in ${input.milestone}`);
  const waited = waitsOf(found);
  if (waited.length === 0) throw new TallyError(`'${input.task}' in ${input.milestone} waits for nothing`);
  const tasks = milestone.tasks.map((task) => (task === found ? withoutWaits(task) : task));
  return {
    ledger: replaceMilestone(ledger, { ...milestone, tasks }),
    message: `${input.milestone} '${input.task}': no longer waits for ${waited.join(", ")}`,
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
