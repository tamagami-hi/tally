import { isAbsolute, join } from "node:path";
import { TallyError } from "../errors.ts";
import { OWN_COMMIT, gitMust, gitOut } from "../git/run.ts";
import { worktreeOf } from "../land/paths.ts";
import { writeRunner } from "../land/runner.ts";
import { commitRecords } from "../records/commit.ts";
import { REPO_NAME } from "../repos/name.ts";
import { DEFAULT_WORKTREE_ROOT, TRACK_BRANCH_PREFIX, type OpenedTrack } from "../schema/tracks.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { reopenRepo, type Repo } from "../store/records.ts";
import { changeTracks, isPresent } from "./file.ts";

export interface OpenTrackInput {
  name: string;
  purpose: string;
  parent?: string;
  paths?: readonly string[];
}

export interface TrackOpened {
  track: OpenedTrack;
  runner: string;
  commit: string | null;
}

function checkedInput(input: OpenTrackInput): void {
  if (!REPO_NAME.test(input.name)) throw new TallyError(`a track's name is lowercase letters, digits, - and _, and starts with a letter or a digit: '${input.name}'`);
  if (input.purpose.trim() === "") throw new TallyError("a track needs a purpose: say in a line what it is for");
  const outside = (input.paths ?? []).find((path) => isAbsolute(path) || path.split("/").includes(".."));
  if (outside !== undefined) throw new TallyError(`a track's paths are relative to its worktree: ${outside}`);
}

function parentFor(repo: Repo, session: Session, asked: string | undefined): string | undefined {
  if (isOperator(repo, session)) return asked;
  if (asked !== undefined && asked !== session.track) throw new TallyError(`session ${session.id} is bound to track ${session.track} and may open only a child of ${session.track}, not of ${asked}`);
  return session.track;
}

async function assertFree(repo: Repo, track: Pick<OpenedTrack, "name" | "branch" | "parent">, folder: string): Promise<void> {
  const { name, branch, parent } = track;
  const known = (await reopenRepo(repo)).config.tracks.map((one) => one.name);
  const tracks = known.length === 0 ? "none" : known.join(", ");
  if (name === repo.config.mainBranch) throw new TallyError(`the name ${name} is the main branch's; pick another name`);
  if (known.includes(name)) throw new TallyError(`the name ${name} is taken; the tracks are ${tracks}`);
  if (parent !== undefined && !known.includes(parent)) throw new TallyError(`no track '${parent}' to be the parent of ${name}; the tracks are ${tracks}`);
  if ((await gitOut(repo.root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])) !== null) throw new TallyError(`the branch ${branch} already exists; delete it, or pick another name`);
  if (await isPresent(folder)) throw new TallyError(`${folder} already exists; move it away, or pick another name`);
}

export async function openTrack(repo: Repo, session: Session, input: OpenTrackInput, now = new Date()): Promise<TrackOpened> {
  checkedInput(input);
  const parent = parentFor(repo, session, input.parent);
  const record: OpenedTrack = {
    name: input.name,
    branch: `${TRACK_BRANCH_PREFIX}${input.name}`,
    worktree: join(repo.config.worktreeRoot ?? DEFAULT_WORKTREE_ROOT, input.name),
    ...(parent === undefined ? {} : { parent }),
    purpose: input.purpose,
    ...(input.paths === undefined ? {} : { paths: [...input.paths] }),
    openedBy: { track: session.track, agent: session.agent },
    openedAt: now.toISOString(),
  };
  const folder = worktreeOf(repo, record);
  const runner = await changeTracks(repo.recordsDir, async (file) => {
    await assertFree(repo, record, folder);
    await gitMust(repo.root, [...OWN_COMMIT, "worktree", "add", "--quiet", "-b", record.branch, folder, repo.config.mainBranch]);
    const written = await writeRunner(repo, folder, record.name);
    return { file: { ...file, tracks: [...file.tracks, record] }, result: written };
  });
  const commit = await commitRecords(repo, `track ${record.name} opened by ${session.agent}`);
  return { track: { ...record, worktree: folder }, runner, commit };
}
