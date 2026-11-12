import { TallyError } from "../errors.ts";
import { askedLimit, askedSince } from "../records/asked.ts";
import type { Repo } from "../store/records.ts";
import { MAX_NAMED, readEntries, type Entry, type EntryKind } from "./entries.ts";
import { applies, overlaps } from "./match.ts";

export interface EntryFilter {
  ids?: readonly string[];
  kind?: EntryKind;
  paths?: readonly string[];
  tags?: readonly string[];
  query?: string;
  since?: string;
  limit?: number;
}

export interface Found {
  entries: Entry[];
  matched: number;
}

type Keep = (entry: Entry) => boolean;

export const MAX_ASKED_PATHS = 100;

const changedAt = (entry: Entry): number => Date.parse(entry.retiredAt ?? entry.at);

export const isInForce = (entry: Entry): boolean => entry.retiredAt === undefined;

export const appliesTo = (entry: Entry, asked: readonly string[]): boolean => entry.paths.length === 0 || entry.paths.some((path) => asked.some((file) => applies(path, file)));

function askedPaths(paths: readonly string[] | undefined): readonly string[] | undefined {
  if (paths === undefined) return undefined;
  if (paths.length > MAX_ASKED_PATHS) throw new TallyError(`at most ${MAX_ASKED_PATHS} paths can be asked at once; this call has ${paths.length}`);
  const long = paths.find((path) => path.length > MAX_NAMED);
  if (long !== undefined) throw new TallyError(`a path asked with holds at most ${MAX_NAMED} characters; this one has ${long.length}`);
  return paths;
}

function tests(filter: EntryFilter): Keep[] {
  const { ids, kind, tags, query, since } = filter;
  const paths = askedPaths(filter.paths);
  const wanted = tags?.map((tag) => tag.toLowerCase());
  const words = query?.toLowerCase();
  const after = since === undefined ? undefined : askedSince(since);
  return [
    ...(ids === undefined && after === undefined ? [isInForce] : []),
    ...(ids === undefined ? [] : [(entry: Entry) => ids.includes(entry.id)]),
    ...(kind === undefined ? [] : [(entry: Entry) => entry.kind === kind]),
    ...(paths === undefined ? [] : [(entry: Entry) => appliesTo(entry, paths)]),
    ...(wanted === undefined ? [] : [(entry: Entry) => entry.tags.some((tag) => wanted.includes(tag.toLowerCase()))]),
    ...(words === undefined ? [] : [(entry: Entry) => entry.title.toLowerCase().includes(words) || entry.text.toLowerCase().includes(words)]),
    ...(after === undefined ? [] : [(entry: Entry) => Date.parse(entry.at) > after || (entry.retiredAt !== undefined && Date.parse(entry.retiredAt) > after)]),
  ];
}

export function keepEntries(entries: readonly Entry[], filter: EntryFilter = {}): Found {
  const limit = askedLimit(filter.limit);
  const keeps = tests(filter);
  const kept = entries.filter((entry) => keeps.every((keep) => keep(entry)));
  const newestFirst = [...kept].reverse().sort((a, b) => changedAt(b) - changedAt(a));
  return { entries: limit === undefined ? newestFirst : newestFirst.slice(0, limit), matched: kept.length };
}

export type EntryTitle = Pick<Entry, "id" | "kind" | "title">;

export async function entriesAbout(repo: Repo, areas: readonly string[]): Promise<EntryTitle[]> {
  if (areas.length === 0) return [];
  const about = (entry: Entry): boolean => isInForce(entry) && entry.paths.some((path) => areas.some((area) => overlaps(path, area)));
  return (await readEntries(repo)).filter(about).map(({ id, kind, title }) => ({ id, kind, title }));
}

export async function findEntries(repo: Repo, filter: EntryFilter = {}): Promise<Found> {
  return keepEntries(await readEntries(repo, filter.kind === undefined ? undefined : [filter.kind]), filter);
}
