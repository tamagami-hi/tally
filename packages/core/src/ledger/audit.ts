import { isUnder } from "../land/paths.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { COVERED } from "./check.ts";
import { MOST_PASSED_SHOWN, filesOn, hashOfLine, owedCommits, passedLine, type PassedCommit } from "./owed.ts";
import { deferredRows } from "./deferred.ts";
import { reviewsWhenRequired } from "../records/reviews.ts";
import { reviewGaps } from "./review-gaps.ts";
import { findGaps, gapsOf } from "./gaps.ts";

export interface PassedCommits {
  total: number;
  shown: PassedCommit[];
}

export interface LedgerCheck {
  missing: string[];
  covered: boolean;
  passed: PassedCommits;
  gaps: string[];
  parked: number;
  note?: string;
  problems?: string[];
}

export interface Checked {
  check: LedgerCheck;
  text: string;
}

async function changingOnly(root: string, lines: readonly string[], paths: readonly string[]): Promise<string[]> {
  const filesOf = filesOn(root);
  const kept: string[] = [];
  for (const line of lines) {
    const files = await filesOf(hashOfLine(line));
    if (files.length > 0 && files.every((file) => isUnder(paths, file))) kept.push(line);
  }
  return kept;
}

const parkedIn = (ledger: Ledger, track?: string): number => deferredRows(ledger).filter((row) => row.state === "parked" && (track === undefined || row.track === track)).length;

interface Found {
  missing: string[];
  passed: PassedCommit[];
  recordsDir: string;
  problem?: string;
}

function answer({ missing, passed, recordsDir, problem }: Found, gaps: string[], parked: number, covers: string, note?: string): Checked {
  const passedText = passedLine(passed.length, recordsDir);
  const check = { missing, covered: missing.length === 0 && problem === undefined, passed: { total: passed.length, shown: passed.slice(0, MOST_PASSED_SHOWN) }, gaps, parked, ...(note === undefined ? {} : { note }), ...(problem === undefined ? {} : { problems: [problem] }) };
  const head = problem ?? (missing.length === 0 ? covers : missing.join("\n"));
  return { check, text: [head, ...(passedText === undefined ? [] : [passedText]), ...gaps, ...(note === undefined ? [] : [note])].join("\n") };
}

export async function checkLedger(repo: Repo, ledger: Ledger, track?: string): Promise<Checked> {
  const { root, config } = repo;
  const owed = await owedCommits(repo, ledger);
  const found = { ...owed, recordsDir: config.records.dir };
  const reviewed = reviewGaps(ledger, await reviewsWhenRequired(repo), config.reviews);
  if (track === undefined) return answer(found, [...findGaps(ledger), ...reviewed].map((gap) => gap.text), parkedIn(ledger), COVERED);
  const gaps = [...gapsOf(ledger, track), ...reviewed.filter((gap) => gap.track === track)].map((gap) => gap.text);
  const paths = config.tracks.find((one) => one.name === track)?.paths;
  const parked = parkedIn(ledger, track);
  if (paths === undefined) return answer(found, gaps, parked, COVERED, `track ${track} has no paths in the config, so missing lists every commit on main no record names, not only ${track}'s`);
  return answer({ ...found, missing: await changingOnly(root, owed.missing, paths) }, gaps, parked, `${COVERED} that changes only ${paths.join(", ")}`);
}
