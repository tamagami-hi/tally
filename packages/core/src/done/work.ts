import { partState } from "../ledger/deferred.ts";
import type { Milestones } from "../ledger/refs.ts";
import { phaseRows, type PhaseRow } from "../phases/rows.ts";
import type { Task } from "../schema/ledger.ts";
import type { StageRow, StatusData } from "../status/collect.ts";
import type { MilestoneRow } from "../status/summary.ts";
import { Records, type Repo } from "../store/records.ts";
import { commitDates, dateOf, type CommitDates } from "./dates.ts";
import type { DoneMilestone, DonePart, DonePhase, DoneTask, DoneWork } from "./types.ts";

export type DoneSource = Pick<StatusData, "rows" | "stages" | "stagePct">;

const isLanded = (task: Task): boolean => task.status === "landed";

function partsOf(ledger: Milestones, task: Task): Pick<DoneTask, "deferred"> {
  const parts = task.deferred ?? [];
  if (parts.length === 0) return {};
  const deferred = parts.map((part): DonePart => ({ what: part.what, ...(part.to === undefined ? {} : { to: part.to }), ...(part.parked === undefined ? {} : { why: part.parked.why }), state: partState(ledger, part) }));
  return { deferred };
}

function timeOf(task: Task, dates: CommitDates): Pick<DoneTask, "at" | "dated"> {
  if (task.landedAt !== undefined) return { at: task.landedAt, dated: "recorded" };
  const at = task.commit === undefined ? undefined : dateOf(dates, task.commit);
  return at === undefined ? {} : { at, dated: "commit" };
}

const momentOf = (task: DoneTask): number | undefined => {
  const at = task.at === undefined ? Number.NaN : Date.parse(task.at);
  return Number.isNaN(at) ? undefined : at;
};

function latestFirst(a: DoneTask, b: DoneTask): number {
  const [first, second] = [momentOf(a), momentOf(b)];
  if (first === undefined || second === undefined) return (first === undefined ? 1 : 0) - (second === undefined ? 1 : 0);
  return second - first;
}

function doneTask(ledger: Milestones, task: Task, dates: CommitDates): DoneTask {
  return { id: task.id, track: task.track, commit: task.commit ?? "", also: [...task.also], ...timeOf(task, dates), ...partsOf(ledger, task) };
}

function doneMilestone(ledger: Milestones, row: MilestoneRow, dates: CommitDates): DoneMilestone {
  const tasks = row.tasks.filter(isLanded).map((task) => doneTask(ledger, task, dates)).toSorted(latestFirst);
  return { id: row.id, name: row.name, track: row.track, finished: row.finished, ...(row.built === undefined ? {} : { built: row.built }), count: row.count, tasks };
}

const isListed = (row: MilestoneRow): boolean => row.finished || row.tasks.some(isLanded);

function closing(stage: StageRow, record: PhaseRow | undefined): Partial<DonePhase> {
  if (stage.state !== "closed") return {};
  return {
    ...(stage.closedAt === undefined ? {} : { closedAt: stage.closedAt }),
    ...(record?.closedBy === undefined ? {} : { closedBy: { ...record.closedBy } }),
    ...(record?.summary === undefined ? {} : { summary: record.summary }),
    ...(record?.commit === undefined ? {} : { commit: record.commit }),
  };
}

function donePhase(source: DoneSource, stage: StageRow, record: PhaseRow | undefined, dates: CommitDates): DonePhase {
  const ledger = { milestones: source.rows };
  const rows = source.rows.filter((row) => row.stage === stage.id);
  const tasks = rows.flatMap((row) => row.tasks);
  return {
    id: stage.id,
    name: stage.name,
    ...(stage.goal === undefined ? {} : { goal: stage.goal }),
    state: stage.state,
    ...closing(stage, record),
    share: source.stagePct[stage.id] ?? 0,
    milestones: { finished: rows.filter((row) => row.finished).length, total: rows.length },
    tasks: { landed: tasks.filter(isLanded).length, total: tasks.length },
    rows: rows.filter(isListed).map((row) => doneMilestone(ledger, row, dates)),
  };
}

const closedTime = (phase: DonePhase): number => (phase.closedAt === undefined ? 0 : Date.parse(phase.closedAt) || 0);

function inOrder(phases: readonly DonePhase[]): DonePhase[] {
  const closed = phases.filter((phase) => phase.state === "closed").toSorted((a, b) => closedTime(b) - closedTime(a));
  return [...closed, ...phases.filter((phase) => phase.state === "open" && phase.rows.length > 0)];
}

export async function doneWork(repo: Repo, source: DoneSource): Promise<DoneWork> {
  const records = await phaseRows(repo);
  const dates = await commitDates(repo, (await new Records(repo).readLedger()).baseline);
  const phases = source.stages.map((stage) => donePhase(source, stage, records.find((one) => one.id === stage.id), dates));
  const counts = {
    phasesClosed: source.stages.filter((stage) => stage.state === "closed").length,
    milestonesFinished: source.rows.filter((row) => row.finished).length,
    tasksLanded: source.rows.flatMap((row) => row.tasks).filter(isLanded).length,
  };
  return { counts, phases: inOrder(phases) };
}
