import { TallyError, messageOf } from "../errors.ts";
import type { PlannedTask } from "../ledger/details.ts";
import { plan } from "../ledger/ops.ts";
import { assertMilestoneOpen } from "../phases/open.ts";
import { commitRecords } from "../records/commit.ts";
import { assertMayWrite, isOperator, type Session } from "../state/sessions.ts";
import { Records, reopenRepo, type Repo } from "../store/records.ts";
import { isOpen, readTracks } from "./file.ts";
import { openTrack, type OpenTrackInput, type TrackOpened } from "./open.ts";

export interface TrackPlan {
  milestone: string;
  tasks: readonly (string | PlannedTask)[];
}

export interface PlannedOnTrack {
  planned?: string;
  planProblem?: string;
}

async function assertPlannable(repo: Repo, track: string, wanted: TrackPlan): Promise<void> {
  const ledger = await new Records(repo).readLedger();
  await assertMilestoneOpen(repo, ledger, wanted.milestone);
  plan(ledger, { milestone: wanted.milestone, track, tasks: wanted.tasks });
}

async function planned(repo: Repo, session: Session, track: string, wanted: TrackPlan): Promise<PlannedOnTrack & { commit?: string | null }> {
  const current = await reopenRepo(repo);
  assertMayWrite(current, session, track);
  const records = new Records(current);
  await assertMilestoneOpen(current, await records.readLedger(), wanted.milestone);
  const message = await records.update((ledger) => plan(ledger, { milestone: wanted.milestone, track, tasks: wanted.tasks }));
  try {
    return { planned: message, commit: await commitRecords(current, message) };
  } catch (error: unknown) {
    return { planned: message, planProblem: `the tasks are planned and not yet committed: ${messageOf(error)}` };
  }
}

async function planOnTrack(repo: Repo, session: Session, track: string, wanted: TrackPlan): Promise<PlannedOnTrack & { commit?: string | null }> {
  try {
    return await planned(repo, session, track, wanted);
  } catch (error: unknown) {
    if (!(error instanceof TallyError)) throw error;
    return { planProblem: `the track is open, and its tasks are not planned: ${messageOf(error)}` };
  }
}

export async function openTrackWithPlan(repo: Repo, session: Session, input: OpenTrackInput, wanted: TrackPlan | undefined, now = new Date()): Promise<TrackOpened & PlannedOnTrack> {
  if (wanted !== undefined) await assertPlannable(repo, input.name, wanted);
  const opened = await openTrack(repo, session, input, now);
  if (wanted === undefined) return opened;
  const { commit, ...told } = await planOnTrack(repo, session, opened.track.name, wanted);
  return { ...opened, ...told, commit: commit ?? opened.commit };
}

export async function plannedOnMainNotice(repo: Repo, session: Session, track: string | undefined): Promise<string | undefined> {
  if (track !== undefined || !isOperator(repo, session)) return undefined;
  const lanes = (await readTracks(repo.recordsDir)).tracks.filter(isOpen).map((one) => one.name);
  if (lanes.length === 0) return undefined;
  const main = repo.config.mainBranch;
  return `these tasks are on ${main}, the main branch's track, as no track was given; the tracks opened with track_open are ${lanes.join(", ")}; give track to plan tasks on one of them`;
}
