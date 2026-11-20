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

export type CheckMode = "each" | "tip";

export interface CommitChecks {
  commit: string;
  checks: TurnCheck[];
}

const SHORT = 7;

async function ownFiles(checkout: string, commit: string): Promise<string[]> {
  const names = await gitMust(checkout, ["diff", "-z", "--name-only", "--no-renames", `${commit}^1`, commit]);
  return [...new Set(names.split("\0").filter((name) => name !== ""))].sort();
}

async function ownChecks(checkout: string, listed: readonly Check[], commit: string): Promise<CommitChecks> {
  const files = await ownFiles(checkout, commit);
  const chosen = checksFor(listed, files);
  if (chosen.length > 0) return { commit, checks: chosen.map(({ name, command }) => ({ name, command })) };
  const subject = await gitMust(checkout, ["log", "-1", "--format=%s", commit]);
  throw new TallyError(`no check in commands.checks covers what ${commit.slice(0, SHORT)} (${subject}) changes: ${namedList(files)}; add a check whose paths match them, however small, so that nothing lands unchecked`);
}

export async function turnPlan(repo: Repo, track: Track, checkout: string, base: string, commits: readonly string[], mode: CheckMode): Promise<CommitChecks[]> {
  const checked = mode === "tip" ? commits.slice(-1) : [...commits];
  const { checks = [] } = repo.config.commands;
  if (checks.length === 0 || mode === "tip") {
    const chosen = await turnChecks(repo, track, checkout, `${base}..${commits.at(-1) ?? base}`);
    return checked.map((commit) => ({ commit, checks: chosen }));
  }
  const plan: CommitChecks[] = [];
  for (const commit of checked) plan.push(await ownChecks(checkout, checks, commit));
  return plan;
}

export async function turnChecks(repo: Repo, track: Track, checkout: string, range: string): Promise<TurnCheck[]> {
  const { checks = [], test } = repo.config.commands;
  if (checks.length === 0) return [{ command: track.test ?? test }];
  const files = await changedFiles(checkout, range);
  const chosen = checksFor(checks, files);
  if (chosen.length === 0) throw new TallyError(`no check in commands.checks covers what this landing changes: ${namedList(files)}; add a check whose paths match them, so that nothing lands unchecked`);
  return chosen.map(({ name, command }) => ({ name, command }));
}
