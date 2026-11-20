import { TallyError } from "../errors.ts";
import { git, gitMust, gitOut, asIdentity } from "../git/run.ts";
import { statePath } from "../land/paths.ts";
import { writeRunner } from "../land/runner.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { TRIAL_BRANCH, assertTrialName, readTrials, trialFolder, trialTrack, trialsFile, withTrial, type Trial } from "./file.ts";
import { hasBranch, isThere, removeTrial } from "./remove.ts";

export const TRIAL_STEPS = (picks: number): number => picks + 4;
export const trialsLock = (repo: Pick<Repo, "stateDir">): string => statePath(repo, "trials.op");

export interface TrialInput {
  name: string;
  tracks: readonly string[];
}

export interface StartedTrial {
  name: string;
  worktree: string;
  head: string;
  tracks: { name: string; commits: number }[];
  runner: string;
}

function assertTracks(repo: Repo, tracks: readonly string[]): void {
  const open = repo.config.tracks.map((track) => track.name);
  if (tracks.length === 0) throw new TallyError("a trial picks the commits of at least one track");
  const unknown = tracks.find((name) => !open.includes(name));
  if (unknown !== undefined) throw new TallyError(`no open track '${unknown}'; open: ${open.join(", ") || "none"}`);
  const twice = tracks.find((name, index) => tracks.indexOf(name) !== index);
  if (twice !== undefined) throw new TallyError(`track ${twice} is named twice`);
}

async function assertFree(repo: Repo, name: string): Promise<void> {
  const held = (await readTrials(repo)).trials.find((trial) => trial.name === name);
  if (held?.state === "open") throw new TallyError(`the trial ${name} is open; end it with trial_end first`);
  if (held !== undefined) await removeTrial(repo, held);
  if (await hasBranch(repo, `${TRIAL_BRANCH}${name}`)) throw new TallyError(`a branch ${TRIAL_BRANCH}${name} exists and is not a trial tally made; choose another name, or delete the branch yourself`);
  if (await isThere(trialFolder(repo, name))) throw new TallyError(`a folder ${trialFolder(repo, name)} exists and is not a trial tally made; choose another name, or remove it yourself`);
}

async function planned(repo: Repo, session: Session, input: TrialInput, now: Date): Promise<Trial> {
  const main = repo.config.mainBranch;
  const tracks = [];
  for (const name of input.tracks) {
    const branch = repo.config.tracks.find((track) => track.name === name)?.branch ?? name;
    const out = (await gitOut(repo.root, ["rev-list", "--reverse", "--no-merges", `${main}..${branch}`])) ?? "";
    tracks.push({ name, commits: out === "" ? [] : out.split("\n") });
  }
  const base = await gitMust(repo.root, ["rev-parse", "--verify", `${main}^{commit}`]);
  return { name: input.name, branch: `${TRIAL_BRANCH}${input.name}`, worktree: trialFolder(repo, input.name), base, tracks, picked: 0, state: "starting", startedAt: now.toISOString(), by: { session: session.id, agent: session.agent } };
}

const recorded = (repo: Repo, trial: Trial): Promise<void> => trialsFile(repo).update((trials) => ({ value: withTrial(trials, trial), result: undefined }));

async function conflicted(repo: Repo, trial: Trial, track: string, commit: string): Promise<TallyError> {
  const files = ((await gitOut(trial.worktree, ["diff", "--name-only", "--diff-filter=U"])) ?? "").split("\n").filter((file) => file !== "");
  const subject = (await gitOut(repo.root, ["log", "-1", "--format=%s", commit])) ?? "";
  await git(trial.worktree, ["cherry-pick", "--abort"]);
  await removeTrial(repo, trial);
  const where = files.length === 0 ? "though git named no file" : `in ${files.join(", ")}`;
  return new TallyError(`the trial ${trial.name} stopped at a conflict: track ${track}'s ${commit.slice(0, 7)} (${subject}) does not apply on the picks before it, ${where}; nothing of the trial is left`);
}

function* picks(trial: Trial): Generator<{ track: string; commit: string }> {
  for (const track of trial.tracks) for (const commit of track.commits) yield { track: track.name, commit };
}

async function steps(repo: Repo, first: Trial, stopAfter: number): Promise<Trial> {
  let trial = first;
  let done = 0;
  const step = async (next: Trial): Promise<boolean> => { trial = next; await recorded(repo, trial); done += 1; return done >= stopAfter; };
  if (await step(trial)) return trial;
  await gitMust(repo.root, ["branch", "--end-of-options", trial.branch, trial.base]);
  if (await step(trial)) return trial;
  await gitMust(repo.root, ["worktree", "add", trial.worktree, trial.branch]);
  if (await step(trial)) return trial;
  for (const { track, commit } of picks(trial)) {
    const picked = await git(trial.worktree, [...asIdentity(repo.config.identity), "cherry-pick", "--allow-empty", "--keep-redundant-commits", commit]);
    if (picked.code !== 0) throw await conflicted(repo, trial, track, commit);
    if (await step({ ...trial, picked: trial.picked + 1 })) return trial;
  }
  await writeRunner(repo, trial.worktree, trialTrack(trial.name), { requireTask: true });
  await step({ ...trial, state: "open", head: await gitMust(trial.worktree, ["rev-parse", "HEAD"]) });
  return trial;
}

export async function startTrial(repo: Repo, session: Session, input: TrialInput, now = new Date(), stopAfter = Number.POSITIVE_INFINITY): Promise<StartedTrial> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session starts a trial");
  assertTrialName(input.name);
  assertTracks(repo, input.tracks);
  return withLock(trialsLock(repo), async () => {
    await assertFree(repo, input.name);
    const trial = await steps(repo, await planned(repo, session, input, now), stopAfter);
    return { name: trial.name, worktree: trial.worktree, head: trial.head ?? "", tracks: trial.tracks.map((track) => ({ name: track.name, commits: track.commits.length })), runner: `${trial.worktree}/.temp/tally/run` };
  });
}
