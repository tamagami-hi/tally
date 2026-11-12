import { z } from "zod";
import { TallyError } from "@tally/core";

export const LIMIT = z.number().int().positive().optional().describe("keep only this many, the most recent");

export const FIELDS = z.array(z.string().min(1)).min(1).optional();

export function latest<T>(rows: readonly T[], limit: number | undefined): T[] {
  return limit === undefined ? [...rows] : rows.slice(-limit);
}

export function pick<T extends object>(row: T, fields: readonly string[] | undefined): Partial<T> {
  if (fields === undefined) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key))) as Partial<T>;
}

export function pickKnown<T extends object>(row: T, fields: readonly string[] | undefined, what: string): Partial<T> {
  const unknown = (fields ?? []).filter((key) => !(key in row));
  if (unknown.length > 0) throw new TallyError(`${what} has no '${unknown.join("', '")}'; its keys: ${Object.keys(row).join(", ")}`);
  return pick(row, fields);
}

export function startedSince<T extends { started: string }>(rows: readonly T[], since: string | undefined): T[] {
  if (since === undefined) return [...rows];
  const from = Date.parse(since);
  if (Number.isNaN(from)) throw new TallyError(`since takes an ISO time such as 2026-11-04T09:00:00Z, not '${since}'`);
  return rows.filter((row) => Date.parse(row.started) >= from);
}
