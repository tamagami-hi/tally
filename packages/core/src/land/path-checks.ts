import { TallyError, namedList } from "../errors.ts";
import { gitMust } from "../git/run.ts";
import type { Check, Track } from "../schema/config.ts";
import type { Repo } from "../store/records.ts";

export interface TurnCheck {
  name?: string;
  command: readonly string[];
}

const ANY_DEPTH = "**";
const WILDCARD = "*";
const REGEX_SPECIAL = /[.+?^${}()|[\]\\]/g;

const literal = (text: string): string => text.replace(REGEX_SPECIAL, "\\$&");

const segmentPattern = (segment: string): string => segment.split(WILDCARD).map(literal).join("[^/]*");

function globPattern(glob: string): RegExp {
  const segments = glob.split("/");
  const last = segments.length - 1;
  const parts = segments.map((segment, index) => {
    if (segment === ANY_DEPTH) return index === last ? "[\\s\\S]*" : "(?:[^/]+/)*";
    return `${segmentPattern(segment)}${index === last ? "" : "/"}`;
  });
  return new RegExp(`^${parts.join("")}$`);
}

export function matchesPath(pattern: string, file: string): boolean {
  const path = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  if (path.includes(WILDCARD)) return globPattern(path).test(file);
  return file === path || file.startsWith(`${path}/`);
}

export function checksFor(listed: readonly Check[], files: readonly string[]): Check[] {
  return listed.filter((check) => check.paths.some((path) => files.some((file) => matchesPath(path, file))));
}

export async function changedFiles(checkout: string, range: string): Promise<string[]> {
  const names = await gitMust(checkout, ["log", "-z", "--format=", "--name-only", "--no-renames", range]);
  return [...new Set(names.split("\0").filter((name) => name !== ""))].sort();
}

export async function turnChecks(repo: Repo, track: Track, checkout: string, range: string): Promise<TurnCheck[]> {
  const { checks = [], test } = repo.config.commands;
  if (checks.length === 0) return [{ command: track.test ?? test }];
  const files = await changedFiles(checkout, range);
  const chosen = checksFor(checks, files);
  if (chosen.length === 0) throw new TallyError(`no check in commands.checks covers what this landing changes: ${namedList(files)}; add a check whose paths match them, so that nothing lands unchecked`);
  return chosen.map(({ name, command }) => ({ name, command }));
}
