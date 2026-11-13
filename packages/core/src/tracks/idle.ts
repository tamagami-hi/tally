import { messageOf, namedList } from "../errors.ts";
import { gitMust } from "../git/run.ts";
import { worktreeOf } from "../land/paths.ts";
import { isActive, queueFile } from "../land/queue.ts";
import { noteFrom } from "../records/notes.ts";
import type { OpenedTrack } from "../schema/tracks.ts";
import { listClaims } from "../state/claims.ts";
import { markTold, readRest } from "../state/rest.ts";
import { listSessions } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import { closeOpened, entriesOf, type CloseBy } from "./close.ts";
import { isOpen, isPresent, readTracks } from "./file.ts";

export interface IdleResult {
  closed: string[];
  problems: string[];
}

export const DEFAULT_WORKTREE_IDLE_MINUTES = 60;

const MS_PER_MINUTE = 60_000;
const CLOSED_FOLDER_NOTE = ".temp/closed";
const TALLY = "tally";

const latest = (times: readonly (string | undefined)[]): number => Math.max(...times.flatMap((time) => (time === undefined ? [] : [Date.parse(time)])));

async function isLanded(repo: Repo, name: string): Promise<boolean> {
  const tasks = (await new Records(repo).readLedger()).milestones.flatMap((milestone) => milestone.tasks).filter((task) => task.track === name);
  return tasks.length > 0 && tasks.every((task) => task.status === "landed");
}

async function isBusy(repo: Repo, tracks: readonly OpenedTrack[], name: string): Promise<boolean> {
  const hasSession = (await listSessions(repo)).some((session) => session.track === name);
  const hasClaim = (await listClaims(repo)).some((claim) => claim.track === name);
  const isQueued = (await queueFile(repo).read()).tickets.some((ticket) => ticket.track === name && isActive(ticket));
  return hasSession || hasClaim || isQueued || tracks.some((one) => one.parent === name && isOpen(one));
}

async function restedSince(repo: Repo, track: OpenedTrack): Promise<number> {
  const landings = (await queueFile(repo).read()).tickets.filter((ticket) => ticket.track === track.name && ticket.state === "landed").map((ticket) => ticket.endedAt);
  return latest([track.openedAt, (await readRest(repo, track.name)).endedAt, ...landings]);
}

async function uncommitted(tree: string): Promise<string[]> {
  const status = await gitMust(tree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return entriesOf(status).map((entry) => entry.path);
}

async function tell(repo: Repo, track: OpenedTrack, text: string, now: Date): Promise<void> {
  const reader = track.parent !== undefined && repo.config.tracks.some((one) => one.name === track.parent) ? track.parent : repo.config.mainBranch;
  await noteFrom(repo, { track: repo.config.mainBranch, agent: TALLY }, { to: [reader], kind: "heads-up", text }, now);
}

async function closeOne(repo: Repo, tracks: readonly OpenedTrack[], track: OpenedTrack, now: Date): Promise<boolean> {
  const { name } = track;
  if (!(await isLanded(repo, name)) || (await isBusy(repo, tracks, name))) return false;
  const ahead = Number(await gitMust(repo.root, ["rev-list", "--count", `${repo.config.mainBranch}..${track.branch}`]));
  if (ahead > 0) return false;
  const since = await restedSince(repo, track);
  const idleFor = Math.floor((now.getTime() - since) / MS_PER_MINUTE);
  if (idleFor < (repo.config.worktrees?.idleMinutes ?? DEFAULT_WORKTREE_IDLE_MINUTES)) return false;
  const tree = worktreeOf(repo, track);
  const files = (await isPresent(tree)) ? await uncommitted(tree) : [];
  if (files.length > 0) {
    const text = `track ${name} is landed and idle, but its worktree holds uncommitted files: ${namedList([...files].sort(), 10)}; commit them, delete them, or close the track yourself`;
    if ((await readRest(repo, name)).told !== text) {
      await tell(repo, track, text, now);
      await markTold(repo, name, text);
    }
    return false;
  }
  const by: CloseBy = { track: repo.config.mainBranch, agent: TALLY };
  const closed = await closeOpened(repo, name, { by, now, why: `landed, and idle since ${new Date(since).toISOString()}` });
  const notes = closed.kept === undefined ? "" : ` Its notes are in ${CLOSED_FOLDER_NOTE}/${closed.kept.split("/").at(-1) ?? name}.`;
  await tell(repo, track, `track ${name} was closed: its work is on main and it sat idle for ${idleFor} minutes.${notes}`, now);
  return true;
}

export async function closeIdleTracks(repo: Repo, now = new Date()): Promise<IdleResult> {
  const result: IdleResult = { closed: [], problems: [] };
  if (repo.config.worktrees?.keep === true) return result;
  const tracks = (await readTracks(repo.recordsDir)).tracks.filter(isOpen);
  for (const track of tracks) {
    try {
      if (await closeOne(repo, tracks, track, now)) result.closed.push(track.name);
    } catch (error: unknown) {
      result.problems.push(`${track.name}: ${messageOf(error)}`);
    }
  }
  return result;
}
