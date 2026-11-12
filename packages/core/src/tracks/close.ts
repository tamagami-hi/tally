import { dirname, relative } from "node:path";
import { TallyError, namedList } from "../errors.ts";
import { revCount } from "../git/refs.ts";
import { gitMust, gitOut } from "../git/run.ts";
import { landingCheckoutPath } from "../land/checkout.ts";
import { worktreeOf } from "../land/paths.ts";
import { RUNNER } from "../land/runner.ts";
import { commitRecords } from "../records/commit.ts";
import type { OpenedTrack, TracksFile } from "../schema/tracks.ts";
import { listClaims } from "../state/claims.ts";
import { isOperator, listSessions, type Session } from "../state/sessions.ts";
import { CONFIG_FILE, type Repo } from "../store/records.ts";
import { changeTracks, isOpen, isPresent } from "./file.ts";

export interface TrackClosed {
  track: OpenedTrack;
  commit: string | null;
}

interface Entry {
  code: string;
  path: string;
}

const IGNORED = "!!";
const OWN_FOLDER = `${dirname(RUNNER)}/`;

const commits = (count: number): string => `${count} commit${count === 1 ? "" : "s"}`;

const named = (paths: readonly string[]): string => namedList([...paths].sort());

function entriesOf(status: string): Entry[] {
  const tokens = status.split("\0").filter((token) => token !== "");
  const entries: Entry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const code = token.slice(0, 2);
    entries.push({ code, path: token.slice(3) });
    if (code.includes("R") || code.includes("C")) index += 1;
  }
  return entries;
}

function openTrackNamed(repo: Repo, file: TracksFile, name: string): OpenedTrack {
  const track = file.tracks.find((one) => one.name === name && isOpen(one));
  if (track !== undefined) return track;
  if (repo.config.tracks.some((one) => one.name === name)) throw new TallyError(`track ${name} is listed in ${CONFIG_FILE}, and tally closes only the tracks it opened`);
  const opened = file.tracks.filter(isOpen).map((one) => one.name).join(", ");
  throw new TallyError(`no open track '${name}'; the tracks tally opened: ${opened === "" ? "none" : opened}`);
}

function assertMayClose(repo: Repo, session: Session, track: OpenedTrack): void {
  if (isOperator(repo, session) || (track.parent !== undefined && session.track === track.parent)) return;
  const parent = track.parent === undefined ? "it has none" : track.parent;
  throw new TallyError(`only an operator session or a session of its parent track (${parent}) closes track ${track.name}`);
}

async function assertIdle(repo: Repo, name: string): Promise<void> {
  const session = (await listSessions(repo)).find((open) => open.track === name);
  if (session !== undefined) throw new TallyError(`track ${name} has an open session (${session.agent}, ${session.id}); close it first`);
  const claim = (await listClaims(repo)).find((held) => held.track === name);
  if (claim !== undefined) throw new TallyError(`track ${name} has a claimed task ('${claim.task}' in ${claim.milestone}, held by ${claim.agent}); release it first`);
}

async function assertNothingToLose(repo: Repo, track: OpenedTrack, tree: string): Promise<void> {
  const main = repo.config.mainBranch;
  const checkout = relative(tree, landingCheckoutPath(tree, track.name));
  const isOwn = (path: string): boolean => path.startsWith(OWN_FOLDER) || path === checkout || path.startsWith(`${checkout}/`);
  const entries = entriesOf(await gitMust(tree, ["status", "--porcelain=v1", "-z", "--ignored", "--untracked-files=all"]));
  const dirty = entries.filter((entry) => entry.code !== IGNORED).map((entry) => entry.path);
  if (dirty.length > 0) throw new TallyError(`track ${track.name} has uncommitted work in ${tree}: ${named(dirty)}; commit it or delete it first`);
  const ahead = await revCount(tree, `${main}..HEAD`);
  if (ahead > 0) throw new TallyError(`the worktree ${tree} is off ${track.branch} and ${commits(ahead)} ahead of ${main}; put its work on a branch of your own, or land it first`);
  const kept = entries.filter((entry) => entry.code === IGNORED && !isOwn(entry.path)).map((entry) => entry.path);
  if (kept.length > 0) throw new TallyError(`closing track ${track.name} would delete ignored files tally did not write: ${named(kept)}; move or delete them first`);
}

async function assertLanded(repo: Repo, branch: string): Promise<void> {
  const main = repo.config.mainBranch;
  const ahead = await revCount(repo.root, `${main}..${branch}`);
  if (ahead > 0) throw new TallyError(`${branch} is ${commits(ahead)} ahead of ${main}; land its work first, or delete the branch yourself`);
}

async function removed(repo: Repo, track: OpenedTrack, tree: string): Promise<void> {
  const checkout = landingCheckoutPath(tree, track.name);
  if (await isPresent(checkout)) await gitMust(repo.root, ["worktree", "remove", "--force", checkout]);
  if (await isPresent(tree)) await gitMust(repo.root, ["worktree", "remove", tree]);
  if ((await gitOut(repo.root, ["rev-parse", "--verify", "-q", `refs/heads/${track.branch}`])) !== null) await gitMust(repo.root, ["branch", "--quiet", "-d", track.branch]);
}

export async function closeTrack(repo: Repo, session: Session, name: string, now = new Date()): Promise<TrackClosed> {
  const track = await changeTracks(repo.recordsDir, async (file) => {
    const open = openTrackNamed(repo, file, name);
    const tree = worktreeOf(repo, open);
    assertMayClose(repo, session, open);
    await assertIdle(repo, name);
    await assertLanded(repo, open.branch);
    if (await isPresent(tree)) await assertNothingToLose(repo, open, tree);
    await removed(repo, open, tree);
    const closed: OpenedTrack = { ...open, closedAt: now.toISOString() };
    return { file: { ...file, tracks: file.tracks.map((one) => (one === open ? closed : one)) }, result: closed };
  });
  return { track, commit: await commitRecords(repo, `track ${name} closed by ${session.agent}`) };
}
