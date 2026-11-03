import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TallyError } from "../errors.ts";
import type { Config } from "../schema/config.ts";
import { onMainOf } from "../status/collect.ts";
import { openQuestions, type OpenQuestions } from "../status/questions.ts";
import { summarize, type MilestoneRow } from "../status/summary.ts";
import { Records, type Repo } from "../store/records.ts";

export const STANDING_START = "<!-- tally:standing -->";
export const STANDING_END = "<!-- /tally:standing -->";

export interface StandingInput {
  stages: Config["stages"];
  stagePct: Record<string, number>;
  overall: number;
  rows: MilestoneRow[];
  tracks: Config["tracks"];
  mainBranch: string;
  questions: OpenQuestions;
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;
const cell = (text: string): string => text.replaceAll("|", "\\|");

function stands(row: MilestoneRow): string {
  if (row.built !== undefined) return "built";
  if (row.count === null) return row.notes.join("; ");
  const notes = row.notes.length === 0 ? "" : `; ${row.notes.join("; ")}`;
  return `${row.count[0]} of ${row.count[1]} tasks landed${notes}`;
}

export function standingBlock(input: StandingInput): string {
  const stages = input.stages.map((s) => `stage ${s.id} ${s.name} ${percent(input.stagePct[s.id] ?? 0)}`).join(", ");
  const tracks = input.tracks.length === 0 ? `none, work lands on ${input.mainBranch}` : input.tracks.map((t) => `${t.name} (\`${t.worktree}\`, \`${t.branch}\`)`).join("; ");
  const questions = input.questions.rows.length === 0 ? "none" : input.questions.rows.join(", ");
  const nextRow = input.questions.nextRow === null ? "unknown" : String(input.questions.nextRow);
  return [
    STANDING_START,
    `**Where the ledger stands** (written whole by \`tally views claude\` from \`docs/records/\`; never edit between these markers): **${percent(input.overall)}** overall${stages === "" ? "" : `; ${stages}`}.`,
    "",
    "| Stage | Milestone | Track | Where it stands |",
    "| --- | --- | --- | --- |",
    ...input.rows.map((row) => `| ${cell(row.stage)} | ${cell(`${row.id} ${row.name}`)} | ${cell(row.track)} | ${cell(stands(row))} |`),
    "",
    `Tracks: ${tracks}. Open questions: ${questions}; the next row is ${nextRow}.`,
    STANDING_END,
  ].join("\n");
}

export function replaceStanding(text: string, block: string): string {
  const start = text.indexOf(STANDING_START);
  const end = text.indexOf(STANDING_END);
  if (start < 0 || end < start) throw new TallyError(`no ${STANDING_START} … ${STANDING_END} markers; add them to CLAUDE.md where the standing block belongs`);
  return `${text.slice(0, start)}${block}${text.slice(end + STANDING_END.length)}`;
}

export async function standingNow(repo: Repo): Promise<string> {
  const ledger = await new Records(repo).readLedger();
  const summary = await summarize(ledger, repo.config.stages, onMainOf(repo));
  return standingBlock({ stages: repo.config.stages, stagePct: summary.stagePct, overall: summary.overall, rows: summary.rows, tracks: repo.config.tracks, mainBranch: repo.config.mainBranch, questions: await openQuestions(repo) });
}

export async function writeClaudeView(repo: Repo, options: { check?: boolean } = {}): Promise<{ path: string; changed: boolean }> {
  const path = join(repo.root, "CLAUDE.md");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new TallyError(`${path} does not exist`);
  }
  const next = replaceStanding(text, await standingNow(repo));
  const changed = next !== text;
  if (changed && options.check !== true) await writeFile(path, next);
  return { path, changed };
}
