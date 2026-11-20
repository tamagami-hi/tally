import { TallyError } from "../errors.ts";
import { provedCommit } from "../git/proved.ts";
import { gitMust } from "../git/run.ts";
import { isWithdrawn, marksOf } from "../records/decision-record.ts";
import { readDecisions, type Decision, type DecisionState } from "../records/decisions.ts";
import { Records, type Repo } from "../store/records.ts";
import { readEntries, type Entry, type EntryKind } from "./entries.ts";
import { appliesTo, isInForce } from "./find.ts";
import { applies } from "./match.ts";
import { citedRecords, type OrderCited } from "./order.ts";
import { inRulebookOrder } from "./rulebook.ts";

export const MOST_FILES = 200;

export interface CoveringInput {
  paths?: readonly string[] | undefined;
  range?: string | undefined;
  task?: string | undefined;
  limit?: number | undefined;
}

export interface Covering {
  files: string[];
  filesTotal: number;
  decisions: { id: string; state: DecisionState; text: string; accept?: string[]; unconfirmed?: true; disputed?: true }[];
  entries: { id: string; kind: EntryKind; title: string; text: string }[];
  cited: OrderCited[];
  unplaced: number;
}

const RANGE = "..";
const RULE: EntryKind = "rule";

async function commitOf(repo: Repo, side: string): Promise<string> {
  const full = await provedCommit(repo.root, side);
  if (full === null) throw new TallyError(`'${side}' is not a commit of ${repo.name}: each side of range is a commit, a branch or a tag`);
  return full;
}

async function rangeFiles(repo: Repo, range: string): Promise<string[]> {
  const sides = range.split(RANGE);
  const [base, head] = sides;
  if (sides.length !== 2 || base === undefined || head === undefined) throw new TallyError(`range is <base>..<head>, two commits; '${range}' is not one`);
  const from = await commitOf(repo, base);
  const to = await commitOf(repo, head);
  return (await gitMust(repo.root, ["diff", "--name-only", from, to])).split("\n").filter((line) => line !== "");
}

async function filesOf(repo: Repo, input: CoveringInput): Promise<string[]> {
  if (input.range !== undefined && input.paths !== undefined) throw new TallyError("covering takes range or paths, not both");
  if (input.range !== undefined) return rangeFiles(repo, input.range);
  if (input.paths !== undefined && input.paths.length > 0) return [...new Set(input.paths)];
  throw new TallyError("covering needs range or paths: the commits a diff spans, or the files and folders asked about");
}

const matches = (decision: Decision, files: readonly string[]): boolean => (decision.paths ?? []).some((path) => files.some((file) => applies(path, file)));

async function citedOf(repo: Repo, task: string | undefined): Promise<OrderCited[]> {
  if (task === undefined) return [];
  const at = task.indexOf(":");
  const milestone = at < 0 ? task : task.slice(0, at);
  const found = (await new Records(repo).readLedger()).milestones.find((one) => one.id === milestone)?.tasks.find((one) => one.id === task.slice(at + 1));
  if (at < 0 || found === undefined) throw new TallyError(`no task '${task}'; give task as MILESTONE:TASK`);
  return citedRecords(repo, found.cites ?? []);
}

function entriesOn(entries: readonly Entry[], files: readonly string[]): Covering["entries"] {
  const applying = entries.filter((entry) => isInForce(entry) && appliesTo(entry, files));
  const ordered = [...inRulebookOrder(applying.filter((entry) => entry.kind === RULE)), ...applying.filter((entry) => entry.kind !== RULE)];
  return ordered.map(({ id, kind, title, text }) => ({ id, kind, title, text }));
}

export async function covering(repo: Repo, input: CoveringInput): Promise<Covering> {
  const all = await filesOf(repo, input);
  const decisions = (await readDecisions(repo)).decisions.filter((one) => !isWithdrawn(one));
  return {
    files: all.slice(0, Math.min(input.limit ?? MOST_FILES, MOST_FILES)),
    filesTotal: all.length,
    decisions: decisions.filter((one) => matches(one, all)).map((one) => ({ id: one.id, state: one.state, text: one.text, ...(one.accept === undefined ? {} : { accept: one.accept }), ...marksOf(one) })),
    entries: entriesOn(await readEntries(repo), all),
    cited: await citedOf(repo, input.task),
    unplaced: decisions.filter((one) => one.state === "in force" && (one.paths ?? []).length === 0).length,
  };
}
