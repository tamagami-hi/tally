import { TallyError, messageOf } from "../errors.ts";
import { isActive, queueFile } from "../land/queue.ts";
import { logActivity, readActivity } from "../records/activity.ts";
import { keepsContextAsRecords } from "../schema/config.ts";
import type { Repo } from "../store/records.ts";
import { endSession } from "./end.ts";
import { listSessions, type Session } from "./sessions.ts";

export const DEFAULT_IDLE_MINUTES = 240;

export const EXPIRED_VERB = "session_expire";

const MS_PER_MINUTE = 60_000;

export interface IdleSessions {
  closed: Session[];
  problems: string[];
}

async function alreadyLogged(repo: Repo, session: Session): Promise<boolean> {
  const { events } = await readActivity(repo, { since: session.lastSeenAt });
  return events.some((event) => event.session === session.id && event.verb === EXPIRED_VERB);
}

const unlogged = (session: Session, reason: string): string => `${session.agent}'s session on track ${session.track} was ended as idle, but its expiry was not logged: ${reason}`;

async function logExpiry(repo: Repo, session: Session, now: Date): Promise<string | undefined> {
  if (!keepsContextAsRecords(repo.config)) return undefined;
  try {
    if (await alreadyLogged(repo, session)) return undefined;
    const idle = Math.floor((now.getTime() - Date.parse(session.lastSeenAt)) / MS_PER_MINUTE);
    await logActivity(repo, { session: session.id, track: session.track, agent: session.agent, verb: EXPIRED_VERB, target: `idle ${idle} min` }, now);
    return undefined;
  } catch (error: unknown) {
    return unlogged(session, messageOf(error));
  }
}

export async function closeIdleSessions(repo: Repo, now = new Date()): Promise<IdleSessions> {
  const limit = (repo.config.sessions?.idleMinutes ?? DEFAULT_IDLE_MINUTES) * MS_PER_MINUTE;
  const isQuiet = (session: Session): boolean => now.getTime() - Date.parse(session.lastSeenAt) > limit;
  const closed: Session[] = [];
  const problems: string[] = [];
  for (const { id } of (await listSessions(repo)).filter(isQuiet)) {
    const still = (await listSessions(repo)).find((session) => session.id === id);
    if (still === undefined || !isQuiet(still)) continue;
    const landing = (await queueFile(repo).read()).tickets.some((ticket) => ticket.sessionId === id && isActive(ticket));
    if (landing) continue;
    const problem = await logExpiry(repo, still, now);
    closed.push((await endSession(repo, id, now)).session);
    if (problem !== undefined) problems.push(problem);
  }
  return { closed, problems };
}

export async function expireSessions(repo: Repo, now = new Date()): Promise<Session[]> {
  const { closed, problems } = await closeIdleSessions(repo, now);
  if (problems.length > 0) throw new TallyError(problems.join("; "));
  return closed;
}
