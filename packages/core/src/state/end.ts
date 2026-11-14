import { flushWhenFree, recordsMode } from "../records/commit.ts";
import { recordsWaiting } from "../records/waiting.ts";
import type { Repo } from "../store/records.ts";
import { releaseClaimsOf } from "./claims.ts";
import { releaseLocksOf } from "./locks.ts";
import { stampRest } from "./rest.ts";
import { closeSession, listSessions, type Session } from "./sessions.ts";

export interface Ended {
  session: Session;
  releasedClaims: Awaited<ReturnType<typeof releaseClaimsOf>>;
  releasedLocks: Awaited<ReturnType<typeof releaseLocksOf>>;
  recordsCommit: string | null;
  records: string;
}

const files = (count: number): string => (count === 1 ? "1 record file waits" : `${count} record files wait`);

async function recordsSaid(repo: Repo, commit: string | null, othersOpen: boolean): Promise<string> {
  const mode = recordsMode(repo.config);
  if (mode === "never") return "this repository commits its records by hand (records.commit is false)";
  if (mode === "each") return "records are committed as each is written (one written during a landing's turn goes in when that landing ends)";
  const waiting = (await recordsWaiting(repo)).files;
  if (mode === "phase") return `${files(waiting)} for the close of the phase (phase_close), or for records_commit`;
  if (commit !== null) return `this was the last session, so the waiting records were committed as ${commit}`;
  if (othersOpen) return "the records wait for the last session to close";
  return waiting === 0 ? "no record was waiting to be committed" : `${files(waiting)}: the landing lock was held, so they go in with the next records commit`;
}

export async function endSession(repo: Repo, sessionId: string, now = new Date()): Promise<Ended> {
  const quitting = (await listSessions(repo)).find((session) => session.id === sessionId);
  if (quitting !== undefined) await stampRest(repo, quitting.track, now);
  const releasedClaims = await releaseClaimsOf(repo, sessionId);
  const releasedLocks = await releaseLocksOf(repo, sessionId);
  const session = await closeSession(repo, sessionId);
  const othersOpen = (await listSessions(repo)).length > 0;
  const recordsCommit = recordsMode(repo.config) === "rest" && !othersOpen ? await flushWhenFree(repo) : null;
  return { session, releasedClaims, releasedLocks, recordsCommit, records: await recordsSaid(repo, recordsCommit, othersOpen) };
}
