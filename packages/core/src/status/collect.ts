import { isAncestor, verifyCommit } from "../git/refs.ts";
import { gitOut } from "../git/run.ts";
import { owedCommits } from "../ledger/owed.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { openQuestions } from "./questions.ts";
import { summarize, type MilestoneRow, type OnMain } from "./summary.ts";
import { needingReview } from "../ledger/review-gaps.ts";
import { reviewsWhenRequired } from "../records/reviews.ts";
import { isClosed, phaseRows } from "../phases/rows.ts";
import { disputedProblems, toConfirm, type ToConfirm } from "../records/decision-record.ts";
import { readDecisions } from "../records/decisions.ts";
import { tolerated } from "../store/json.ts";
import { closedState, type GitState } from "./closed.ts";
import { branches, type TrackRow } from "./tracks.ts";
import { trialProblems } from "../trials/file.ts";

export interface StageRow {
  id: string;
  name: string;
  goal?: string;
  state: "open" | "closed";
  closedAt?: string;
}

export interface StatusData {
  name: string;
  time: string;
  overall: number;
  stagePct: Record<string, number>;
  stages: StageRow[];
  rows: MilestoneRow[];
  tracks: TrackRow[];
  main: string;
  origin: string | null;
  unpushed: number;
  today: number;
  questions: string[];
  nextRow: number | null;
  problems: string[];
  toConfirm: ToConfirm[];
}

function stamp(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
}

export function onMainOf(repo: Repo): OnMain {
  return async (commit) => {
    const full = await verifyCommit(repo.root, commit);
    return full !== null && (await isAncestor(repo.root, full, repo.config.mainBranch));
  };
}

async function liveState(repo: Repo, now: Date): Promise<GitState> {
  const { root } = repo;
  const main = repo.config.mainBranch;
  const origin = await gitOut(root, ["rev-parse", "--short", `origin/${main}`]);
  const unpushed = origin === null ? 0 : Number((await gitOut(root, ["rev-list", "--count", `origin/${main}..${main}`])) ?? "0");
  const today = ((await gitOut(root, ["log", "--since=midnight", "--format=%h", main])) ?? "").split("\n").filter((l) => l.length > 0).length;
  return { time: now, tracks: await branches(root, main, now.getTime() / 1000), main: (await gitOut(root, ["log", "-1", "--format=%h %s", main])) ?? "", origin, unpushed, today };
}

export async function collect(repo: Repo, ledger: Ledger, now = new Date()): Promise<StatusData> {
  const { root, config } = repo;
  const main = config.mainBranch;
  const summary = await summarize(ledger, config.stages, onMainOf(repo), needingReview(ledger, await reviewsWhenRequired(repo), config.reviews));
  const { missing } = repo.cycle === undefined ? await owedCommits(repo, ledger) : { missing: [] };
  const problems = [...(repo.problems ?? []), ...summary.problems];
  if (missing.length > 0) problems.push(`commits on main not in the ledger (record them): ${missing.join("; ")}`);
  const decisions = await tolerated(readDecisions(repo), { schema: 1 as const, decisions: [], replaced: [] });
  problems.push(...(decisions.problem === undefined ? [] : [decisions.problem]), ...disputedProblems(decisions.value));
  if (repo.cycle === undefined) problems.push(...(await trialProblems(repo, now)));
  const git = repo.cycle === undefined ? await liveState(repo, now) : await closedState(repo, repo.cycle);
  const questions = await openQuestions(repo);
  return {
    name: config.name,
    time: stamp(git.time),
    overall: summary.overall,
    stagePct: summary.stagePct,
    stages: (await phaseRows(repo)).map((row): StageRow => ({ id: row.id, name: row.name, ...(row.goal === undefined ? {} : { goal: row.goal }), state: isClosed(row) ? "closed" : "open", ...(row.closedAt === undefined ? {} : { closedAt: row.closedAt }) })),
    rows: summary.rows,
    tracks: git.tracks,
    main: git.main,
    origin: git.origin,
    unpushed: git.unpushed,
    today: git.today,
    questions: questions.rows,
    nextRow: questions.nextRow,
    problems,
    toConfirm: toConfirm(decisions.value),
  };
}
