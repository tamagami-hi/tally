import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { assertCurrent, type Repo } from "../store/records.ts";
import { askedLimit, askedSince } from "./asked.ts";
import type { Exact, Known } from "../schema/kept.ts";

export const ACTIVITY_DIR = "log";
export const CLI_SESSION = "cli";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DAY_LENGTH = 10;

export const activityEventSchema = z.looseObject({
  at: z.string(),
  session: z.string().min(1),
  track: z.string().min(1),
  agent: z.string().min(1),
  verb: z.string().min(1),
  target: z.string().optional(),
});

export const activityFileSchema = z.looseObject({
  schema: z.literal(1),
  date: z.string().regex(DAY),
  events: z.array(activityEventSchema).default([]),
});

export type ActivityEvent = Exact<z.infer<typeof activityEventSchema>>;
export type ActivityFile = Exact<z.infer<typeof activityFileSchema>>;
export type ActivityInput = Omit<Known<ActivityEvent>, "at">;

export interface ActivityFilter {
  since?: string;
  track?: string;
  limit?: number;
}

export interface Activity {
  events: ActivityEvent[];
  matched: number;
}

const dayOf = (time: Date | number): string => new Date(time).toISOString().slice(0, DAY_LENGTH);

export const activityPath = (repo: Repo, day: string): string => join(repo.recordsDir, ACTIVITY_DIR, `${day}.json`);

async function readDay(repo: Repo, day: string): Promise<ActivityFile> {
  try {
    return await readJson(activityPath(repo, day), activityFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, date: day, events: [] };
    throw error;
  }
}

async function loggedDays(repo: Repo): Promise<string[]> {
  try {
    const names = await readdir(join(repo.recordsDir, ACTIVITY_DIR));
    return names.flatMap((name) => DAY_FILE.exec(name)?.[1] ?? []).sort();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function logActivity(repo: Repo, input: ActivityInput, now = new Date()): Promise<ActivityEvent> {
  assertCurrent(repo);
  const event: ActivityEvent = { at: now.toISOString(), session: input.session, track: input.track, agent: input.agent, verb: input.verb, ...(input.target === undefined ? {} : { target: input.target }) };
  const day = dayOf(now);
  const path = activityPath(repo, day);
  await withLock(path, async () => {
    const file = await readDay(repo, day);
    await writeJsonAtomic(path, activityFileSchema.parse({ ...file, events: [...file.events, event] }));
  });
  return event;
}

export async function readActivity(repo: Repo, filter: ActivityFilter = {}): Promise<Activity> {
  const limit = askedLimit(filter.limit);
  const after = filter.since === undefined ? undefined : askedSince(filter.since);
  const days = (await loggedDays(repo)).filter((day) => after === undefined || day >= dayOf(after));
  const files = await Promise.all(days.map((day) => readDay(repo, day)));
  const kept = files.flatMap((file) => file.events).filter((event) => (after === undefined || Date.parse(event.at) > after) && (filter.track === undefined || event.track === filter.track));
  return { events: limit === undefined ? kept : kept.slice(-limit), matched: kept.length };
}

export interface NewestDays {
  events: ActivityEvent[];
  days: number;
  earlier: number;
}

export async function readNewestDays(repo: Repo, most: number): Promise<NewestDays> {
  const days = await loggedDays(repo);
  const newest = days.slice(-most);
  const files = await Promise.all(newest.map((day) => readDay(repo, day)));
  return { events: files.flatMap((file) => file.events), days: days.length, earlier: days.length - newest.length };
}
