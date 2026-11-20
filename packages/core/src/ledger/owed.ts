import { provedCommit } from "../git/proved.ts";
import { logLines } from "../git/refs.ts";
import { gitMust, gitOut } from "../git/run.ts";
import { isUnder } from "../land/paths.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { unrecorded } from "./check.ts";

export const RECORDS_ONLY = "records only";
export const MOST_PASSED_SHOWN = 10;
const END_OF_NAME = "\0";

export interface PassedCommit {
  commit: string;
  subject: string;
  why: string;
}

export interface Owed {
  missing: string[];
  passed: PassedCommit[];
  problem?: string;
}

export type FilesOf = (commit: string) => Promise<readonly string[]>;

export const hashOfLine = (line: string): string => line.split(" ", 1)[0] ?? line;

const subjectOfLine = (line: string): string => {
  const space = line.indexOf(" ");
  return space === -1 ? "" : line.slice(space + 1);
};

export function filesOn(root: string): FilesOf {
  return async (commit) => {
    const parent = await gitOut(root, ["rev-parse", "--verify", "-q", `${commit}^1`]);
    const trees = parent === null ? ["--root", commit] : [parent, commit];
    const out = await gitMust(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", ...trees]);
    return out.split(END_OF_NAME).filter((name) => name !== "");
  };
}

export async function owedCommits(repo: Repo, ledger: Ledger, filesOf: FilesOf = filesOn(repo.root)): Promise<Owed> {
  const { root, config } = repo;
  const baseline = await provedCommit(root, ledger.baseline);
  if (baseline === null) return { missing: [], passed: [], problem: `the ledger's baseline '${ledger.baseline}' is not a commit of ${repo.name}, so main is not checked against the ledger; set baseline to the commit the ledger starts from` };
  const candidates = unrecorded(ledger, await logLines(root, `${baseline}..${config.mainBranch}`), config.records.commitPrefix);
  const missing: string[] = [];
  const passed: PassedCommit[] = [];
  for (const line of candidates) {
    const files = await filesOf(hashOfLine(line));
    if (files.length > 0 && files.every((file) => isUnder([config.records.dir], file))) passed.push({ commit: hashOfLine(line), subject: subjectOfLine(line), why: RECORDS_ONLY });
    else missing.push(line);
  }
  return { missing, passed };
}

export function passedLine(count: number, recordsDir: string): string | undefined {
  if (count === 0) return undefined;
  return count === 1 ? `the check passes over 1 commit on main that changes only files under ${recordsDir}` : `the check passes over ${count} commits on main that change only files under ${recordsDir}`;
}
