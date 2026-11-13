import { namedList } from "../errors.ts";
import { findGaps, type Gap } from "../ledger/gaps.ts";
import { ownersOf } from "../ledger/items.ts";
import { checkLedger } from "../ledger/audit.ts";
import { isActive, queueFile, type Ticket } from "../land/queue.ts";
import type { Ledger, Milestone } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";

export const MOST_LEFT = 10;
const EVERYONE = "all";

export interface Context {
  missing: string[];
  gaps: Gap[];
  tickets: Ticket[];
}

export interface PhaseTasks {
  milestones: Milestone[];
  total: number;
  landed: number;
  unlanded: string[];
}

export const milestonesOf = (ledger: Ledger, phase: string): Milestone[] => ledger.milestones.filter((milestone) => milestone.stage === phase);

export function tasksOf(ledger: Ledger, phase: string): PhaseTasks {
  const milestones = milestonesOf(ledger, phase);
  const tasks = milestones.flatMap((milestone) => milestone.tasks.map((task) => ({ milestone: milestone.id, task })));
  const unlanded = tasks.filter(({ task }) => task.status !== "landed").map(({ milestone, task }) => `${milestone} / ${task.id}`);
  return { milestones, total: tasks.length, landed: tasks.length - unlanded.length, unlanded };
}

export async function contextOf(repo: Repo, ledger: Ledger): Promise<Context> {
  const { check } = await checkLedger(repo, ledger);
  return { missing: check.missing, gaps: findGaps(ledger), tickets: (await queueFile(repo).read()).tickets.filter(isActive) };
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

export function blockersOf(context: Context, ledger: Ledger, phase: string): string[] {
  const { milestones, unlanded } = tasksOf(ledger, phase);
  const ids = new Set(milestones.map((milestone) => milestone.id));
  const owners = new Set(milestones.flatMap((milestone) => ownersOf(milestone).split("+")));
  const tasks = unlanded.length === 0 ? [] : [`${unlanded.length} of its tasks ${plural(unlanded.length, "is", "are")} not landed (${namedList(unlanded, MOST_LEFT)}); land them, or remove a planned one with task_remove`];
  const hashes = context.missing.map((line) => line.split(" ", 1)[0] ?? line);
  const commits = hashes.length === 0 ? [] : [`main has ${hashes.length} ${plural(hashes.length, "commit", "commits")} the ledger does not record (${namedList(hashes, MOST_LEFT)}); record each with task_land or task_other`];
  const gaps = context.gaps.filter((gap) => ids.has(gap.milestone)).map((gap) => gap.text);
  const queued = context.tickets.filter((ticket) => owners.has(EVERYONE) || owners.has(ticket.track)).map((ticket) => `track ${ticket.track} has a landing in the queue (ticket ${ticket.id}); wait for it with land_wait, or cancel it with land_cancel`);
  return [...tasks, ...commits, ...gaps, ...queued];
}
