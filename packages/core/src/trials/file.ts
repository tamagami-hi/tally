import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { statePath } from "../land/paths.ts";
import { StateFile } from "../state/file.ts";
import type { Repo } from "../store/records.ts";

export const TRIALS_DIR = ".temp/tally/trials";
export const TRIAL_BRANCH = "trial/";
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const trialSchema = z.looseObject({
  name: z.string().min(1),
  branch: z.string().min(1),
  worktree: z.string().min(1),
  base: z.string().min(1),
  tracks: z.array(z.looseObject({ name: z.string().min(1), commits: z.array(z.string().min(1)) })),
  picked: z.number().int().nonnegative(),
  state: z.enum(["starting", "open"]),
  head: z.string().optional(),
  startedAt: z.string(),
  by: z.looseObject({ session: z.string().min(1), agent: z.string().min(1) }),
});

const trialsSchema = z.looseObject({ trials: z.array(trialSchema).default([]) });

export type Trial = z.infer<typeof trialSchema>;
export type Trials = z.infer<typeof trialsSchema>;

export const trialsFile = (repo: Pick<Repo, "stateDir">): StateFile<Trials> => new StateFile(statePath(repo, "trials.json"), trialsSchema, () => ({ trials: [] }));

export const readTrials = (repo: Pick<Repo, "stateDir">): Promise<Trials> => trialsFile(repo).read();

export const trialFolder = (repo: Pick<Repo, "root">, name: string): string => join(repo.root, TRIALS_DIR, name);

export const trialTrack = (name: string): string => `trial-${name}`;

export function assertTrialName(name: string): void {
  if (!NAME.test(name)) throw new TallyError(`'${name}' is not a trial's name: it is lower-case letters, digits, '-' and '_', beginning with a letter or a digit`);
}

export function trialNamed(trials: Trials, name: string): Trial {
  const found = trials.trials.find((trial) => trial.name === name);
  if (found === undefined) throw new TallyError(`no trial ${name}; trials: ${trials.trials.map((trial) => trial.name).join(", ") || "none"}`);
  return found;
}

export const withTrial = (trials: Trials, trial: Trial): Trials => ({ ...trials, trials: [...trials.trials.filter((one) => one.name !== trial.name), trial] });

export const withoutTrial = (trials: Trials, name: string): Trials => ({ ...trials, trials: trials.trials.filter((one) => one.name !== name) });

export const openTrials = async (repo: Pick<Repo, "stateDir">): Promise<Trial[]> => (await readTrials(repo)).trials.filter((trial) => trial.state === "open");

const DAY_MS = 86_400_000;

export async function trialProblems(repo: Pick<Repo, "stateDir">, now: Date): Promise<string[]> {
  return (await openTrials(repo)).filter((trial) => now.getTime() - Date.parse(trial.startedAt) > DAY_MS).map((trial) => `the trial ${trial.name} has been open since ${trial.startedAt}: end it with trial_end once its checks are read`);
}
