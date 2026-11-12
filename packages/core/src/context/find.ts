import { askedLimit, askedSince } from "../records/asked.ts";
import type { Repo } from "../store/records.ts";
import { readEntries, type Entry, type EntryKind } from "./entries.ts";
import { applies } from "./match.ts";

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

const changedAt = (entry: Entry): number => Date.parse(entry.retiredAt ?? entry.at);

export const isInForce = (entry: Entry): boolean => entry.retiredAt === undefined;

export const appliesTo = (entry: Entry, asked: readonly string[]): boolean => entry.paths.length === 0 || entry.paths.some((path) => asked.some((file) => applies(path, file)));

function tests(filter: EntryFilter): Keep[] {
  const { ids, kind, paths, tags, query, since } = filter;
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

export async function findEntries(repo: Repo, filter: EntryFilter = {}): Promise<Found> {
  return keepEntries(await readEntries(repo, filter.kind === undefined ? undefined : [filter.kind]), filter);
}
