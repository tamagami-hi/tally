import { z } from "zod";

interface TooLong {
  path?: readonly PropertyKey[] | undefined;
  maximum: number | bigint;
  input?: unknown;
}

interface BadKey {
  code?: string;
  issues?: readonly { message: string }[];
}

const UNNAMED = "the text";

function nameOf(path: readonly PropertyKey[] = []): string {
  const named = [...path].reverse().find((key) => typeof key === "string");
  return typeof named === "string" ? named : UNNAMED;
}

const tooLong = (name?: string) => (issue: TooLong): string => `${name ?? nameOf(issue.path)} holds at most ${String(issue.maximum)} characters; this one has ${typeof issue.input === "string" ? issue.input.length : "more"}`;

export const limitedText = (most: number, least?: number, name?: string): z.ZodString => (least === undefined ? z.string() : z.string().min(least)).max(most, { error: tooLong(name) });

export const keyRefusal = (issue: BadKey): string | undefined => (issue.code === "invalid_key" ? issue.issues?.[0]?.message : undefined);
