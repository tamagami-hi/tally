import { z } from "zod";
import { TallyError } from "@tally/core";

export const MOST_LISTED = 200;

export const LIMIT = z.number().int().positive().max(MOST_LISTED).optional();

export const FIELDS = z.array(z.string().min(1)).min(1).optional();

const ISO_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const UNKNOWN_START = 0;

type Row = Readonly<Record<string, unknown>>;

interface Started {
  started: string;
}

export function latest<T>(rows: readonly T[], limit: number | undefined): T[] {
  return limit === undefined ? [...rows] : rows.slice(-limit);
}

export function pick(row: Row, fields: readonly string[] | undefined): Row {
  return fields === undefined ? row : Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key)));
}

export function pickKnown(row: Row, fields: readonly string[] | undefined, what: string): Row {
  const unknown = (fields ?? []).filter((key) => !Object.hasOwn(row, key));
  if (unknown.length > 0) throw new TallyError(`${what} has no '${unknown.join("', '")}'; its keys: ${Object.keys(row).join(", ")}`);
  return pick(row, fields);
}

function startOf(row: Started): number {
  const at = Date.parse(row.started);
  return Number.isNaN(at) ? UNKNOWN_START : at;
}

export function startedSince<T extends Started>(rows: readonly T[], since: string | undefined): T[] {
  if (since === undefined) return [...rows];
  const from = ISO_TIME.test(since) ? Date.parse(since) : Number.NaN;
  if (Number.isNaN(from)) throw new TallyError(`since takes an ISO time such as 2026-11-04T09:00:00Z, not '${since}'`);
  return rows.filter((row) => startOf(row) >= from);
}

export function lastStarted<T extends Started>(rows: readonly T[], limit: number | undefined): T[] {
  if (limit === undefined) return [...rows];
  const newest = new Set([...rows].sort((a, b) => startOf(a) - startOf(b)).slice(-limit));
  return rows.filter((row) => newest.has(row));
}
