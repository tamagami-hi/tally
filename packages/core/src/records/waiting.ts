import { TallyError } from "../errors.ts";
import { git, gitMust } from "../git/run.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import type { Repo } from "../store/records.ts";
import { commitWhenFree, recordsMode, type Staged } from "./commit.ts";
import { clearPendingPhase } from "./pending-phase.ts";

export interface Waiting {
  files: number;
  since: string | null;
}

const MOST_WHY = 200;

const folded = (text: string): string => text.trim().replaceAll(/\s+/g, " ");

export async function recordsWaiting(repo: Repo): Promise<Waiting> {
  const status = await git(repo.root, ["status", "--porcelain=v1", "--untracked-files=all", "-z", "--", repo.config.records.dir]);
  const files = status.stdout.split("\0").filter((token) => token !== "").length;
  const last = await git(repo.root, ["log", "-1", "--format=%cI", `--grep=^${repo.config.records.commitPrefix}`]);
  return { files, since: last.stdout.trim() === "" ? null : last.stdout.trim() };
}

export async function commitWaitingRecords(repo: Repo, session: Pick<Session, "track" | "agent">, why: string): Promise<Staged> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session commits the waiting records; a track that wants them committed asks a question with question_add");
  if (recordsMode(repo.config) === "never") throw new TallyError("this repository turned tally's records commits off (records.commit is false); commit docs/records/ yourself, or turn them on with repo_configure");
  const reason = folded(why);
  if (reason === "") throw new TallyError("committing the records needs a why, in a line");
  if (reason.length > MOST_WHY) throw new TallyError(`the why holds at most ${MOST_WHY} characters; this one has ${reason.length}`);
  await gitMust(repo.root, ["rev-parse", "--verify", "-q", "HEAD"]);
  const done = await commitWhenFree(repo, (files) => `${files} record file${files === 1 ? "" : "s"}, ${reason}`);
  if (!done.waits) await clearPendingPhase(repo);
  return done;
}
