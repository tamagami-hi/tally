import { TallyError } from "../errors.ts";
import { CLI_SESSION, readNewestDays, type ActivityEvent } from "../records/activity.ts";
import { evidenceKinds } from "../records/evidence.ts";
import { keepsContextAsRecords } from "../schema/config.ts";
import { EXPIRED_VERB } from "../state/expire.ts";
import { listSessions } from "../state/sessions.ts";
import type { Repo } from "../store/records.ts";

export const ENDED_LIMIT = 50;
export const MOST_ENDED = 500;
export const LOG_WINDOW_DAYS = 120;

const MOST_TASKS = 8;
const OPENED_VERB = "session_open";
const CLOSED_VERB = "session_close";
const TASK_VERBS: ReadonlySet<string> = new Set(["task_claim", "task_land", "land_start", "review_record", "evidence_record"]);
const NOT_WRITES: ReadonlySet<string> = new Set([OPENED_VERB, CLOSED_VERB, EXPIRED_VERB]);
const EVIDENCE_VERB = "evidence_record";
const KIND_ENDINGS: readonly string[] = evidenceKinds.map((kind) => `, ${kind}`);

export interface EndedSession {
  id: string;
  track: string;
  agent: string;
  from: string;
  to: string;
  opened: "recorded" | "first write";
  ended: "closed" | "expired" | "unknown";
  writes: number;
  tasks: string[];
  moreTasks?: number;
}

export interface EndedSessions {
  kept: boolean;
  sessions: EndedSession[];
  total: number;
  earlier?: number;
}

function checkedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MOST_ENDED) throw new TallyError(`limit must be a whole number from 1 to ${MOST_ENDED}, not ${limit}`);
  return limit;
}

function bySession(events: readonly ActivityEvent[]): ActivityEvent[][] {
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const group = groups.get(event.session);
    if (group === undefined) groups.set(event.session, [event]);
    else group.push(event);
  }
  return [...groups.values()];
}

function tasksOf({ verb, target }: ActivityEvent): string[] {
  if (!TASK_VERBS.has(verb) || target === undefined) return [];
  if (verb !== EVIDENCE_VERB) return [target];
  const ending = KIND_ENDINGS.find((one) => target.endsWith(one));
  return [ending === undefined ? target : target.slice(0, -ending.length)];
}

function endOf(verbs: ReadonlySet<string>): EndedSession["ended"] {
  if (verbs.has(CLOSED_VERB)) return "closed";
  return verbs.has(EXPIRED_VERB) ? "expired" : "unknown";
}

function endedOf(events: readonly ActivityEvent[]): EndedSession[] {
  const first = events[0];
  const last = events.at(-1);
  if (first === undefined || last === undefined) return [];
  const tasks = [...new Set(events.flatMap(tasksOf))];
  return [{
    id: first.session,
    track: first.track,
    agent: first.agent,
    from: first.at,
    to: last.at,
    opened: first.verb === OPENED_VERB ? "recorded" : "first write",
    ended: endOf(new Set(events.map((event) => event.verb))),
    writes: events.filter((event) => !NOT_WRITES.has(event.verb)).length,
    tasks: tasks.slice(0, MOST_TASKS),
    ...(tasks.length > MOST_TASKS ? { moreTasks: tasks.length - MOST_TASKS } : {}),
  }];
}

const endTime = (session: EndedSession): number => Date.parse(session.to) || 0;

export async function endedSessions(repo: Repo, options: { limit?: number } = {}): Promise<EndedSessions> {
  const limit = checkedLimit(options.limit ?? ENDED_LIMIT);
  const read = await readNewestDays(repo, LOG_WINDOW_DAYS);
  if (!keepsContextAsRecords(repo.config) && read.days === 0) return { kept: false, sessions: [], total: 0 };
  const open = new Set((await listSessions(repo)).map((session) => session.id));
  const ended = bySession(read.events.filter((event) => event.session !== CLI_SESSION && !open.has(event.session))).flatMap(endedOf);
  const latest = ended.toSorted((a, b) => endTime(b) - endTime(a));
  return { kept: true, sessions: latest.slice(0, limit), total: latest.length, ...(read.earlier === 0 ? {} : { earlier: read.earlier }) };
}
