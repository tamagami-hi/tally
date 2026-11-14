import { logLines } from "../git/refs.ts";
import { gitMust } from "../git/run.ts";
import { isUnder } from "../land/paths.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { COVERED, unrecorded } from "./check.ts";
import { deferredRows } from "./deferred.ts";
import { findGaps, gapsOf } from "./gaps.ts";

export interface LedgerCheck {
  missing: string[];
  covered: boolean;
  gaps: string[];
  parked: number;
  note?: string;
}

export interface Checked {
  check: LedgerCheck;
  text: string;
}

const END_OF_NAME = "\0";

async function changedFiles(root: string, commit: string): Promise<string[]> {
  const out = await gitMust(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "-z", commit]);
  return out.split(END_OF_NAME).filter((name) => name !== "");
}

async function changingOnly(root: string, lines: readonly string[], paths: readonly string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const line of lines) {
    const files = await changedFiles(root, line.split(" ", 1)[0] ?? line);
    if (files.length > 0 && files.every((file) => isUnder(paths, file))) kept.push(line);
  }
  return kept;
}

const parkedIn = (ledger: Ledger, track?: string): number => deferredRows(ledger).filter((row) => row.state === "parked" && (track === undefined || row.track === track)).length;

function answer(missing: string[], gaps: string[], parked: number, covers: string, note?: string): Checked {
  const check = { missing, covered: missing.length === 0, gaps, parked, ...(note === undefined ? {} : { note }) };
  return { check, text: [missing.length === 0 ? covers : missing.join("\n"), ...gaps, ...(note === undefined ? [] : [note])].join("\n") };
}

export async function checkLedger(repo: Repo, ledger: Ledger, track?: string): Promise<Checked> {
  const { root, config } = repo;
  const missing = unrecorded(ledger, await logLines(root, `${ledger.baseline}..${config.mainBranch}`), config.records.commitPrefix);
  if (track === undefined) return answer(missing, findGaps(ledger).map((gap) => gap.text), parkedIn(ledger), COVERED);
  const gaps = gapsOf(ledger, track).map((gap) => gap.text);
  const paths = config.tracks.find((one) => one.name === track)?.paths;
  const parked = parkedIn(ledger, track);
  if (paths === undefined) return answer(missing, gaps, parked, COVERED, `track ${track} has no paths in the config, so missing lists every commit on main no record names, not only ${track}'s`);
  return answer(await changingOnly(root, missing, paths), gaps, parked, `${COVERED} that changes only ${paths.join(", ")}`);
}
