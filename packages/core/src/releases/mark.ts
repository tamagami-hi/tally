import { TallyError } from "../errors.ts";
import { provedCommit } from "../git/proved.ts";
import { isAncestor, shortOf } from "../git/refs.ts";
import { commitRecords } from "../records/commit.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { assertCurrent, type Repo } from "../store/records.ts";
import { MOST_RELEASE_NOTES, assertVersion, readReleases, releasesFileSchema, releasesPath, type Release } from "./file.ts";

const SHORT = 7;

export interface ReleaseInput {
  version: string;
  commit?: string;
  notes?: string;
}

async function onMain(repo: Repo, given: string | undefined): Promise<string> {
  const main = repo.config.mainBranch;
  const asked = given ?? main;
  const full = await provedCommit(repo.root, asked);
  if (full === null) throw new TallyError(`'${asked}' is not a commit of ${repo.name}: give a commit on main, as a hash or a ref`);
  const short = await shortOf(repo.root, full, SHORT);
  if (!(await isAncestor(repo.root, full, main))) throw new TallyError(`${short} is not on main: a release is marked on a commit main has`);
  return short;
}

async function assertInOrder(repo: Repo, releases: readonly Release[], version: string, commit: string): Promise<void> {
  const held = releases.find((one) => one.version === version);
  if (held !== undefined) throw new TallyError(`release ${version} is already recorded, at ${held.commit}`);
  const latest = releases.at(-1);
  if (latest === undefined || (await isAncestor(repo.root, latest.commit, commit))) return;
  throw new TallyError(`${version} at ${commit} is before ${latest.version} at ${latest.commit}: releases are marked in main's order, each at or after the latest`);
}

function assertInput(repo: Repo, session: Session, input: ReleaseInput): void {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session marks a release");
  assertVersion(input.version);
  if (input.notes !== undefined && input.notes.length > MOST_RELEASE_NOTES) throw new TallyError(`a release's notes hold at most ${MOST_RELEASE_NOTES} characters; these have ${input.notes.length}`);
}

export async function markRelease(repo: Repo, session: Session, input: ReleaseInput, now = new Date()): Promise<{ release: Release; commit: string | null }> {
  assertCurrent(repo);
  assertInput(repo, session, input);
  const commit = await onMain(repo, input.commit);
  const path = releasesPath(repo);
  const release = await withLock(path, async () => {
    const file = await readReleases(repo);
    await assertInOrder(repo, file.releases, input.version, commit);
    const made: Release = { version: input.version, commit, at: now.toISOString(), by: { session: session.id, track: session.track, agent: session.agent }, ...(input.notes === undefined ? {} : { notes: input.notes }) };
    await writeJsonAtomic(path, releasesFileSchema.parse({ ...file, releases: [...file.releases, made] }));
    return made;
  });
  return { release, commit: await commitRecords(repo, `release ${release.version} marked at ${release.commit}`) };
}
