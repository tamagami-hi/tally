import { namedList } from "../errors.ts";
import { isActive, queueFile } from "../land/queue.ts";
import { owedCommits } from "../ledger/owed.ts";
import { needingReview } from "../ledger/review-gaps.ts";
import { isClosed, phaseRows } from "../phases/rows.ts";
import { reviewsWhenRequired } from "../records/reviews.ts";
import type { Ledger, Milestone } from "../schema/ledger.ts";
import { onMainOf } from "../status/collect.ts";
import { summarize } from "../status/summary.ts";
import type { Repo } from "../store/records.ts";
import { closeBlocker } from "../tracks/close.ts";
import { isOpen, readableTracks } from "../tracks/file.ts";

export const MOST_NAMED = 10;

export interface CycleState {
  finished: string[];
  carried: string[];
  unfinished: string[];
  tracksCarried: string[];
  tracksToClose: string[];
  blockers: string[];
}

export const isCarried = (milestone: Milestone): boolean => milestone.built === undefined && milestone.tasks.every((task) => task.status !== "landed");

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

async function finishedIds(repo: Repo, ledger: Ledger): Promise<Set<string>> {
  const needing = needingReview(ledger, await reviewsWhenRequired(repo), repo.config.reviews);
  const { rows } = await summarize(ledger, repo.config.stages, onMainOf(repo), needing);
  return new Set(rows.filter((row) => row.finished).map((row) => row.id));
}

function tracksOf(ledger: Ledger, carried: ReadonlySet<string>, opened: readonly string[]): { carried: string[]; others: string[] } {
  const tasks = ledger.milestones.flatMap((milestone) => milestone.tasks.map((task) => ({ milestone: milestone.id, track: task.track })));
  const isCarriedTrack = (name: string): boolean => {
    const own = tasks.filter((task) => task.track === name);
    return own.length > 0 && own.every((task) => carried.has(task.milestone));
  };
  return { carried: opened.filter(isCarriedTrack), others: opened.filter((name) => !isCarriedTrack(name)) };
}

async function queueBlockers(repo: Repo): Promise<string[]> {
  const tickets = (await queueFile(repo).read()).tickets.filter(isActive);
  return tickets.map((ticket) => `track ${ticket.track} has a landing ${ticket.state === "turn" ? "at its turn" : "in the queue"} (ticket ${ticket.id}); wait for it with land_wait, or cancel it with land_cancel`);
}

async function owedBlockers(repo: Repo, ledger: Ledger): Promise<string[]> {
  const owed = await owedCommits(repo, ledger);
  if (owed.problem !== undefined) return [owed.problem];
  const hashes = owed.missing.map((line) => line.split(" ", 1)[0] ?? line);
  if (hashes.length === 0) return [];
  return [`main has ${hashes.length} ${plural(hashes.length, "commit", "commits")} the ledger does not record (${namedList(hashes, MOST_NAMED)}); record each with task_land or task_other`];
}

async function trackBlockers(repo: Repo, names: readonly string[]): Promise<string[]> {
  const said: string[] = [];
  for (const name of names) {
    const why = await closeBlocker(repo, name);
    if (why !== undefined) said.push(`track ${name} is neither carried (its tasks all in milestones not started) nor closable now: ${why}`);
  }
  return said;
}

async function phaseBlockers(repo: Repo, ledger: Ledger, carried: ReadonlySet<string>): Promise<string[]> {
  const closed = new Set((await phaseRows(repo)).filter(isClosed).map((row) => row.id));
  return ledger.milestones.filter((milestone) => carried.has(milestone.id) && closed.has(milestone.stage)).map((milestone) => `${milestone.id} is not started and sits in phase ${milestone.stage}, which is closed; remove it with milestone_remove, or start it in an open phase`);
}

export async function cycleState(repo: Repo, ledger: Ledger, n: number): Promise<CycleState> {
  const finishedSet = await finishedIds(repo, ledger);
  const carried = ledger.milestones.filter(isCarried).map((milestone) => milestone.id);
  const carriedSet = new Set(carried);
  const unfinished = ledger.milestones.filter((milestone) => !carriedSet.has(milestone.id) && !finishedSet.has(milestone.id)).map((milestone) => milestone.id);
  const opened = (await readableTracks(repo.recordsDir)).value.tracks.filter(isOpen).map((track) => track.name);
  const tracks = tracksOf(ledger, carriedSet, opened);
  const finished = ledger.milestones.filter((milestone) => finishedSet.has(milestone.id)).map((milestone) => milestone.id);
  const blockers = [
    ...(await queueBlockers(repo)),
    ...(await owedBlockers(repo, ledger)),
    ...unfinished.map((id) => `${id} has landed work and is not finished: land or remove its other tasks, and drop what it still owes with milestone_edit`),
    ...(await trackBlockers(repo, tracks.others)),
    ...(await phaseBlockers(repo, ledger, carriedSet)),
    ...(finished.length === 0 ? [`no milestone of cycle ${n} is finished yet`] : []),
  ];
  return { finished, carried, unfinished, tracksCarried: tracks.carried, tracksToClose: tracks.others, blockers };
}

export async function cycleComplete(repo: Repo, ledger: Ledger, n: number): Promise<boolean> {
  const finishedSet = await finishedIds(repo, ledger);
  const carriedSet = new Set(ledger.milestones.filter(isCarried).map((milestone) => milestone.id));
  if (finishedSet.size === 0 || ledger.milestones.some((milestone) => !carriedSet.has(milestone.id) && !finishedSet.has(milestone.id))) return false;
  if ((await queueBlockers(repo)).length > 0 || (await owedBlockers(repo, ledger)).length > 0) return false;
  if ((await phaseBlockers(repo, ledger, carriedSet)).length > 0) return false;
  const opened = (await readableTracks(repo.recordsDir)).value.tracks.filter(isOpen).map((track) => track.name);
  return (await trackBlockers(repo, tracksOf(ledger, carriedSet, opened).others)).length === 0;
}

export const askOf = (n: number): string => `everything planned in cycle ${n} has landed: ask the operator whether to close it; cycle_close takes their words in \`said\``;
