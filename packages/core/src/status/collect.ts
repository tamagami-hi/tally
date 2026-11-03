import { isAncestor, logLines, verifyCommit } from "../git/refs.ts";
import { gitOut } from "../git/run.ts";
import { unrecorded } from "../ledger/check.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { openQuestions } from "./questions.ts";
import { summarize, type MilestoneRow, type OnMain } from "./summary.ts";
import { branches, type TrackRow } from "./tracks.ts";

export interface StatusData {
  name: string;
  time: string;
  overall: number;
  stagePct: Record<string, number>;
  stages: { id: string; name: string }[];
  rows: MilestoneRow[];
  tracks: TrackRow[];
  main: string;
  origin: string | null;
  unpushed: number;
  today: number;
  questions: string[];
  nextRow: number | null;
  problems: string[];
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

export async function collect(repo: Repo, ledger: Ledger, now = new Date()): Promise<StatusData> {
  const { root, config } = repo;
  const main = config.mainBranch;
  const summary = await summarize(ledger, config.stages, onMainOf(repo));
  const missing = unrecorded(ledger, await logLines(root, `${ledger.baseline}..${main}`), config.records.commitPrefix);
  const problems = [...summary.problems];
  if (missing.length > 0) problems.push(`commits on main not in the ledger (record them): ${missing.join("; ")}`);
  const origin = await gitOut(root, ["rev-parse", "--short", `origin/${main}`]);
  const unpushed = origin === null ? 0 : Number((await gitOut(root, ["rev-list", "--count", `origin/${main}..${main}`])) ?? "0");
  const today = ((await gitOut(root, ["log", "--since=midnight", "--format=%h", main])) ?? "").split("\n").filter((l) => l.length > 0).length;
  const questions = await openQuestions(repo);
  return {
    name: config.name,
    time: stamp(now),
    overall: summary.overall,
    stagePct: summary.stagePct,
    stages: config.stages.map((s) => ({ id: s.id, name: s.name })),
    rows: summary.rows,
    tracks: await branches(root, main, now.getTime() / 1000),
    main: (await gitOut(root, ["log", "-1", "--format=%h %s", main])) ?? "",
    origin,
    unpushed,
    today,
    questions: questions.rows,
    nextRow: questions.nextRow,
    problems,
  };
}
