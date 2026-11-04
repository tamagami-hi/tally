import { TallyError, messageOf } from "../errors.ts";
import { resolveOnMain } from "../git/refs.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import { land, type LandInput } from "../ledger/ops.ts";
import { commitRecords } from "../records/commit.ts";
import type { Ledger } from "../schema/ledger.ts";
import { releaseLanded, type Claim } from "../state/claims.ts";
import { assertMayWrite, type Session } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import type { Landed } from "./run.ts";

export interface LandingTarget {
  milestone: string;
  task: string;
}

export interface RecordedTask {
  message: string;
  released: Claim | null;
  problem?: string;
}

export interface LandingRecord {
  recorded: boolean;
  message: string;
  commit: string | null;
  problem?: string;
}

export function landingTarget(milestone: string | undefined, task: string | undefined): LandingTarget | undefined {
  if (milestone === undefined && task === undefined) return undefined;
  if (milestone === undefined || task === undefined) throw new TallyError("a landing records a task from both its milestone and its task", 2);
  return { milestone, task };
}

function scoped(repo: Repo, session: Session, ledger: Ledger, input: LandInput): LandInput {
  const track = findTask(findMilestone(ledger, input.milestone), input.task)?.track ?? input.track ?? session.track;
  assertMayWrite(repo, session, track);
  return { ...input, track };
}

async function releasing(repo: Repo, input: LandInput): Promise<Omit<RecordedTask, "message">> {
  try {
    return { released: await releaseLanded(repo, input.milestone, input.task) };
  } catch (error: unknown) {
    return { released: null, problem: `its claim is still held: ${messageOf(error)}` };
  }
}

export async function recordTask(repo: Repo, input: LandInput, session?: Session): Promise<RecordedTask> {
  const records = new Records(repo);
  const allowed = session === undefined ? input : scoped(repo, session, await records.readLedger(), input);
  const message = await records.update((ledger) => land(ledger, allowed, resolveOnMain(repo.root, repo.config.mainBranch)));
  return { message, ...(await releasing(repo, input)) };
}

export async function recordLanding(repo: Repo, landed: Landed, target: LandingTarget, session?: Session): Promise<LandingRecord> {
  const { milestone, task } = target;
  const { track, head, commits } = landed;
  if (commits.length === 0) return { recorded: false, message: `nothing new landed, so ${milestone} '${task}' is not recorded`, commit: null };
  try {
    const { message, problem } = await recordTask(repo, { milestone, task, track, commit: head, also: commits.slice(0, -1) }, session);
    return { recorded: true, message, commit: await commitRecords(repo, message), ...(problem === undefined ? {} : { problem }) };
  } catch (error: unknown) {
    return { recorded: false, message: `landed at ${head}, but recording ${milestone} '${task}' failed: ${messageOf(error)}; finish it with tally task land ${milestone} '${task}' ${head}`, commit: null };
  }
}
