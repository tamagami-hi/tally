import { TallyError } from "../errors.ts";

const TIME_SHAPE = "2026-11-12T09:00:00Z";

export function askedSince(since: string): number {
  const time = Date.parse(since);
  if (Number.isNaN(time)) throw new TallyError(`since must be an ISO time such as ${TIME_SHAPE}, not '${since}'`);
  return time;
}

export function askedLimit(limit: number | undefined): number | undefined {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new TallyError(`limit must be a whole number above zero, not ${limit}`);
  return limit;
}
