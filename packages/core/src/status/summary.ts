import { uncovered, unfinished } from "../ledger/gaps.ts";
import { ownersOf } from "../ledger/items.ts";
import type { Milestones } from "../ledger/refs.ts";
import { waitsOf } from "../ledger/waits.ts";
import type { Needing } from "../ledger/review-gaps.ts";
import type { Stage } from "../schema/config.ts";
import type { Ledger, Milestone, Task } from "../schema/ledger.ts";

export { ownersOf } from "../ledger/items.ts";

export type OnMain = (commit: string) => Promise<boolean>;

export interface MilestoneRow extends Milestone {
  share: number;
  count: [number, number] | null;
  notes: string[];
}

export interface Summary {
  rows: MilestoneRow[];
  stagePct: Record<string, number>;
  overall: number;
  problems: string[];
}

export function ago(epoch: number, now = Date.now() / 1000): string {
  const minutes = Math.floor((now - epoch) / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

const isWaiting = (task: Task): boolean => waitsOf(task).length > 0;

function openNotes(tasks: readonly Task[]): string[] {
  const open = tasks.filter((task) => task.commit === undefined);
  const nextByTrack = new Map<string, string>();
  for (const task of open) {
    if (!isWaiting(task) && !nextByTrack.has(task.track)) nextByTrack.set(task.track, task.id);
  }
  return [...[...nextByTrack].map(([track, id]) => `${track} next: ${id}`), ...open.filter(isWaiting).map((task) => `${task.id}: waits for ${waitsOf(task).join(", ")}`)];
}

function reviewNotes(milestone: string, tasks: readonly Task[], needing: readonly Needing[]): string[] {
  return tasks.flatMap((task) => {
    const one = needing.find((need) => need.milestone === milestone && need.task === task.id);
    if (one === undefined) return [];
    return [one.latest === undefined ? `${task.id}: no review` : `${task.id}: ${one.latest.id} open, ${one.latest.blocking} blocking`];
  });
}

function owedNotes(ledger: Milestones, milestone: Pick<Milestone, "delivers" | "tasks">, tasks: readonly Task[]): string[] {
  const partly = tasks.flatMap((task) => {
    const parts = unfinished(ledger, task);
    const parked = (task.deferred ?? []).filter((part) => part.parked !== undefined).length;
    return [...(parts.length === 0 ? [] : [`${task.id} landed in part: ${parts.map((part) => part.what).join(", ")}`]), ...(parked === 0 ? [] : [`${task.id}: ${parked} parked`])];
  });
  const owed = uncovered(milestone);
  return [...partly, ...(owed.length === 0 ? [] : [`no task covers ${owed.map((one) => one.id).join(", ")}`])];
}

async function row(ledger: Ledger, milestone: Milestone, onMain: OnMain, problems: string[], needing: readonly Needing[]): Promise<MilestoneRow> {
  const owed = [...owedNotes(ledger, milestone, milestone.tasks), ...reviewNotes(milestone.id, milestone.tasks, needing)];
  if (milestone.built !== undefined) return { ...milestone, share: 1, count: null, notes: ["built", ...owed] };
  if (milestone.tasks.length === 0) {
    const note = milestone.waits === undefined ? "not started" : `waits for ${milestone.waits}`;
    return { ...milestone, share: 0, count: null, notes: [note, ...owed] };
  }
  let landed = 0;
  for (const task of milestone.tasks) {
    for (const commit of [task.commit, ...task.also]) {
      if (commit !== undefined && !(await onMain(commit))) problems.push(`${milestone.id} '${task.id}': ${commit} is not on main`);
    }
    if (task.commit !== undefined && (await onMain(task.commit))) landed += 1;
  }
  return { ...milestone, share: landed / milestone.tasks.length, count: [landed, milestone.tasks.length], notes: [...openNotes(milestone.tasks), ...owed] };
}

export function rowsOf(rows: readonly MilestoneRow[], track: string): MilestoneRow[] {
  return rows
    .filter((row) => row.track.split("+").includes(track) || row.tasks.some((task) => task.track === track))
    .map((row) => {
      const tasks = row.tasks.filter((task) => task.track === track);
      return { ...row, tasks, notes: row.count === null ? row.notes : [...openNotes(tasks), ...owedNotes({ milestones: rows }, row, tasks)] };
    });
}

export async function summarize(ledger: Ledger, stages: readonly Stage[], onMain: OnMain, needing: readonly Needing[] = []): Promise<Summary> {
  const problems: string[] = [];
  const rows: MilestoneRow[] = [];
  for (const milestone of ledger.milestones) rows.push({ ...(await row(ledger, milestone, onMain, problems, needing)), track: ownersOf(milestone) });
  const stagePct: Record<string, number> = {};
  for (const stage of stages) {
    const inStage = rows.filter((r) => r.stage === stage.id);
    const weight = inStage.reduce((sum, r) => sum + r.weight, 0);
    stagePct[stage.id] = weight === 0 ? 0 : inStage.reduce((sum, r) => sum + r.weight * r.share, 0) / weight;
  }
  const total = stages.reduce((sum, stage) => sum + stage.weight, 0);
  const overall = total === 0 ? 0 : stages.reduce((sum, stage) => sum + stage.weight * (stagePct[stage.id] ?? 0), 0) / total;
  return { rows, stagePct, overall, problems };
}
