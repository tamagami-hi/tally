import { isActive, queueFile } from "../land/queue.ts";
import type { Repo } from "../store/records.ts";
import { endSession } from "./end.ts";
import { listSessions, type Session } from "./sessions.ts";

export const DEFAULT_IDLE_MINUTES = 240;

const MS_PER_MINUTE = 60_000;

export async function expireSessions(repo: Repo, now = new Date()): Promise<Session[]> {
  const limit = (repo.config.sessions?.idleMinutes ?? DEFAULT_IDLE_MINUTES) * MS_PER_MINUTE;
  const isQuiet = (session: Session): boolean => now.getTime() - Date.parse(session.lastSeenAt) > limit;
  const closed: Session[] = [];
  for (const { id } of (await listSessions(repo)).filter(isQuiet)) {
    const still = (await listSessions(repo)).find((session) => session.id === id);
    if (still === undefined || !isQuiet(still)) continue;
    const landing = (await queueFile(repo).read()).tickets.some((ticket) => ticket.sessionId === id && isActive(ticket));
    if (landing) continue;
    closed.push((await endSession(repo, id)).session);
  }
  return closed;
}
