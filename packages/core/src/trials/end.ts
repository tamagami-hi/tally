import { TallyError } from "../errors.ts";
import { gitOut } from "../git/run.ts";
import { statusEntries } from "../git/status.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { readTrials, trialNamed, type Trial } from "./file.ts";
import { assertOwn, isThere, removeTrial } from "./remove.ts";
import { trialsLock } from "./start.ts";

const IGNORED = "!!";
const TALLYS_OWN = ".temp/tally/";
const SHORT = 7;

const commits = (count: number): string => `${count} commit${count === 1 ? "" : "s"}`;

async function beyond(trial: Trial, cwd: string, tip: string): Promise<string[]> {
  const out = (await gitOut(cwd, ["log", "--format=%H%x09%s", `${trial.head ?? trial.base}..${tip}`])) ?? "";
  return out === "" ? [] : out.split("\n");
}

async function assertNothingToLose(repo: Repo, trial: Trial): Promise<void> {
  if (!(await isThere(trial.worktree))) return;
  const dirty = (await statusEntries(trial.worktree, ["--ignored"])).filter((entry) => entry.code !== IGNORED && !entry.path.startsWith(TALLYS_OWN)).map((entry) => entry.path);
  if (dirty.length > 0) throw new TallyError(`the trial ${trial.name} has uncommitted work in ${trial.worktree}: ${dirty.join(", ")}; move it to a lane first`);
  const extra = [...new Set([...(await beyond(trial, repo.root, trial.branch)), ...(await beyond(trial, trial.worktree, "HEAD"))])];
  if (extra.length === 0) return;
  const named = extra.map((line) => { const [sha = "", subject = ""] = line.split("\t"); return `${sha.slice(0, SHORT)} (${subject})`; });
  throw new TallyError(`the trial ${trial.name} has ${commits(extra.length)} beyond its picks: ${named.join(", ")}; move it to a lane first`);
}

export interface EndedTrial {
  name: string;
  removed: { worktree: string; branch?: string };
  left?: string[];
}

export async function endTrial(repo: Repo, session: Session, name: string): Promise<EndedTrial> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session ends a trial");
  return withLock(trialsLock(repo), async () => {
    const trial = trialNamed(await readTrials(repo), name);
    assertOwn(repo, trial);
    if (trial.state === "open") await assertNothingToLose(repo, trial);
    const { left, ...removed } = await removeTrial(repo, trial);
    return { name, removed, ...(left.length === 0 ? {} : { left }) };
  });
}
