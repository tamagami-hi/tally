import { TallyError, namedList } from "../errors.ts";
import { gitMust, gitOut } from "../git/run.ts";
import { statusEntries } from "../git/status.ts";
import { landingCheckoutPath } from "../land/checkout.ts";
import { worktreeOf } from "../land/paths.ts";
import { isActive, queueFile } from "../land/queue.ts";
import { commitRecords } from "../records/commit.ts";
import { SCRATCH_ROOT } from "../state/scratch.ts";
import type { OpenedTrack, TracksFile } from "../schema/tracks.ts";
import { listClaims } from "../state/claims.ts";
import { isOperator, listSessions, type Session } from "../state/sessions.ts";
import { CONFIG_FILE, type Repo } from "../store/records.ts";
import { changeTracks, isOpen, isPresent, readTracks } from "./file.ts";
import { endSession } from "../state/end.ts";
import { clearRest } from "../state/rest.ts";
import { discardKept, keepScratch } from "./keep.ts";

export interface Cleaned {
  names: string[];
  total: number;
  what?: string;
}

const CLEANED = "files git ignores under these top-level folders were deleted with the worktree (build output and installed packages); notes under .temp/ were kept, and `kept` says where when there were any";

export interface TrackClosed {
  track: OpenedTrack;
  commit: string | null;
  cleaned: Cleaned;
  kept?: string;
}

export interface CloseBy {
  track: string;
  agent: string;
}

export interface CloseOptions {
  by: CloseBy;
  now?: Date;
  why?: string;
  check?: (track: OpenedTrack) => void;
  commit?: boolean;
}

const IGNORED = "!!";
const MOST_NAMED_CLEANED = 20;

const commits = (count: number): string => `${count} commit${count === 1 ? "" : "s"}`;

const named = (paths: readonly string[]): string => namedList([...paths].sort());

const revCount = async (cwd: string, range: string): Promise<number> => Number(await gitMust(cwd, ["rev-list", "--count", range]));

const isScratch = (path: string): boolean => path === SCRATCH_ROOT || path.startsWith(`${SCRATCH_ROOT}/`);

function openTrackNamed(repo: Repo, file: TracksFile, name: string): OpenedTrack {
  const track = file.tracks.find((one) => one.name === name && isOpen(one));
  if (track !== undefined) return track;
  if (repo.config.tracks.some((one) => one.name === name)) throw new TallyError(`track ${name} is listed in ${CONFIG_FILE}, and tally closes only the tracks it opened`);
  const opened = file.tracks.filter(isOpen).map((one) => one.name).join(", ");
  throw new TallyError(`no open track '${name}'; the tracks tally opened: ${opened === "" ? "none" : opened}`);
}

export function assertMayClose(repo: Repo, session: Pick<Session, "track">, track: OpenedTrack): void {
  if (isOperator(repo, session) || (track.parent !== undefined && session.track === track.parent)) return;
  const parent = track.parent === undefined ? "it has none" : track.parent;
  throw new TallyError(`only an operator session or a session of its parent track (${parent}) closes track ${track.name}`);
}

async function assertIdle(repo: Repo, file: TracksFile, name: string): Promise<void> {
  const session = (await listSessions(repo)).find((open) => open.track === name);
  if (session !== undefined) throw new TallyError(`track ${name} has an open session (${session.agent}, ${session.id}); close it first, or pass endSessions: true to end the sessions that hold no claim`);
  const claim = (await listClaims(repo)).find((held) => held.track === name);
  if (claim !== undefined) throw new TallyError(`track ${name} has a claimed task ('${claim.task}' in ${claim.milestone}, held by ${claim.agent}); release it first`);
  const ticket = (await queueFile(repo).read()).tickets.find((one) => one.track === name && isActive(one));
  if (ticket !== undefined) throw new TallyError(`track ${name} has a landing in the queue (ticket ${ticket.id}); wait for it to end, or cancel it`);
  const child = file.tracks.find((one) => one.parent === name && isOpen(one));
  if (child !== undefined) throw new TallyError(`track ${name} has an open child (${child.name}); close it first`);
}

async function assertNothingToLose(repo: Repo, track: OpenedTrack, tree: string): Promise<Cleaned> {
  const main = repo.config.mainBranch;
  const entries = await statusEntries(tree, ["--ignored"]);
  const dirty = entries.filter((entry) => entry.code !== IGNORED).map((entry) => entry.path);
  if (dirty.length > 0) throw new TallyError(`track ${track.name} has uncommitted work in ${tree}: ${named(dirty)}; commit it or delete it first`);
  const ahead = await revCount(tree, `${main}..HEAD`);
  if (ahead > 0) throw new TallyError(`the worktree ${tree} is off ${track.branch} and ${commits(ahead)} ahead of ${main}; put its work on a branch of your own, or land it first`);
  const cleaned = [...new Set(entries.filter((entry) => !isScratch(entry.path)).map((entry) => entry.path.split("/")[0] ?? entry.path))].sort();
  return { names: cleaned.slice(0, MOST_NAMED_CLEANED), total: cleaned.length, ...(cleaned.length === 0 ? {} : { what: CLEANED }) };
}

async function assertLanded(repo: Repo, branch: string): Promise<void> {
  const main = repo.config.mainBranch;
  const ahead = await revCount(repo.root, `${main}..${branch}`);
  if (ahead > 0) throw new TallyError(`${branch} is ${commits(ahead)} ahead of ${main}; land its work first, or delete the branch yourself`);
  const unseen = await revCount(repo.root, `HEAD..${branch}`);
  if (unseen > 0) throw new TallyError(`the checkout at ${repo.root} is not on ${main} and lacks ${commits(unseen)} of ${branch}, so git would keep the branch; check out ${main} there first`);
}

async function removed(repo: Repo, track: OpenedTrack, tree: string, now: Date): Promise<string | undefined> {
  const checkout = landingCheckoutPath(tree, track.name);
  if (await isPresent(checkout)) await gitMust(repo.root, ["worktree", "remove", "--force", checkout]);
  const kept = (await isPresent(tree)) ? await keepScratch(repo, tree, track.name, now) : undefined;
  try {
    if (await isPresent(tree)) await gitMust(repo.root, ["worktree", "remove", tree]);
  } catch (error: unknown) {
    if (kept !== undefined) await discardKept(kept);
    throw error;
  }
  if ((await gitOut(repo.root, ["rev-parse", "--verify", "-q", `refs/heads/${track.branch}`])) !== null) await gitMust(repo.root, ["branch", "--quiet", "-d", track.branch]);
  return kept;
}

export async function closeBlocker(repo: Repo, name: string): Promise<string | undefined> {
  try {
    const file = await readTracks(repo.recordsDir);
    const open = openTrackNamed(repo, file, name);
    const tree = worktreeOf(repo, open);
    await assertIdle(repo, file, name);
    await assertLanded(repo, open.branch);
    if (await isPresent(tree)) await assertNothingToLose(repo, open, tree);
    return undefined;
  } catch (error: unknown) {
    if (error instanceof TallyError) return error.message;
    throw error;
  }
}

export async function closeOpened(repo: Repo, name: string, options: CloseOptions): Promise<TrackClosed> {
  const now = options.now ?? new Date();
  const done = await changeTracks(repo.recordsDir, async (file) => {
    const open = openTrackNamed(repo, file, name);
    const tree = worktreeOf(repo, open);
    options.check?.(open);
    await assertIdle(repo, file, name);
    await assertLanded(repo, open.branch);
    const cleaned = (await isPresent(tree)) ? await assertNothingToLose(repo, open, tree) : { names: [], total: 0 };
    const kept = await removed(repo, open, tree, now);
    const closed: OpenedTrack = { ...open, closedAt: now.toISOString(), closedBy: options.by, ...(options.why === undefined ? {} : { closedWhy: options.why }) };
    return { file: { ...file, tracks: file.tracks.map((one) => (one === open ? closed : one)) }, result: { track: closed, cleaned, kept } };
  });
  await clearRest(repo, name);
  const commit = options.commit === false ? null : await commitRecords(repo, `track ${name} closed by ${options.by.agent}`);
  return { track: done.track, commit, cleaned: done.cleaned, ...(done.kept === undefined ? {} : { kept: done.kept }) };
}

async function endClaimless(repo: Repo, session: Session, name: string, now: Date): Promise<Session[]> {
  const track = openTrackNamed(repo, await readTracks(repo.recordsDir), name);
  assertMayClose(repo, session, track);
  const open = (await listSessions(repo)).filter((one) => one.track === name);
  const claims = await listClaims(repo);
  const holding = open.find((one) => claims.some((claim) => claim.sessionId === one.id));
  const claim = claims.find((one) => one.sessionId === holding?.id);
  if (holding !== undefined && claim !== undefined) throw new TallyError(`track ${name} has a session that holds a claim ('${claim.task}' in ${claim.milestone}, held by ${holding.agent}, session ${holding.id}); it releases the task or closes first`);
  for (const one of open) await endSession(repo, one.id, now);
  return open;
}

export async function closeTrack(repo: Repo, session: Session, name: string, now = new Date(), options: { endSessions?: boolean } = {}): Promise<TrackClosed & { ended?: Session[] }> {
  const ended = options.endSessions === true ? await endClaimless(repo, session, name, now) : undefined;
  const closed = await closeOpened(repo, name, { by: { track: session.track, agent: session.agent }, now, check: (track) => assertMayClose(repo, session, track) });
  return ended === undefined ? closed : { ...closed, ended };
}
