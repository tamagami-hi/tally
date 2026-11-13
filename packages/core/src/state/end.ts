import { flushWhenFree, recordsMode } from "../records/commit.ts";
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
}

export async function endSession(repo: Repo, sessionId: string, now = new Date()): Promise<Ended> {
  const quitting = (await listSessions(repo)).find((session) => session.id === sessionId);
  if (quitting !== undefined) await stampRest(repo, quitting.track, now);
  const releasedClaims = await releaseClaimsOf(repo, sessionId);
  const releasedLocks = await releaseLocksOf(repo, sessionId);
  const session = await closeSession(repo, sessionId);
  const recordsCommit = recordsMode(repo.config) === "rest" && (await listSessions(repo)).length === 0 ? await flushWhenFree(repo) : null;
  return { session, releasedClaims, releasedLocks, recordsCommit };
}
