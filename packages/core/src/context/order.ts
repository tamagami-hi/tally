import { readCycles } from "../cycles/file.ts";
import { gitOut } from "../git/run.ts";
import { waitsOf } from "../ledger/waits.ts";
import { findCited, type Cited, type Lookup } from "../records/cited.ts";
import { readDecisions, type DecisionState, type DecisionsFile } from "../records/decisions.ts";
import { readHandoff, type HandoffNote } from "../records/handoffs.ts";
import type { Ledger } from "../schema/ledger.ts";
import { listClaims, type Claim } from "../state/claims.ts";
import { listSessions, type Session } from "../state/sessions.ts";
import { branches } from "../status/tracks.ts";
import { tolerated } from "../store/json.ts";
import { Records, type Repo } from "../store/records.ts";
import { rulebookOf, type BriefRule, type BriefTask, type Rulebook, type Working } from "./brief-level.ts";
import { readEntries, type Entry, type EntryKind } from "./entries.ts";
import { isInForce } from "./find.ts";
import { overlaps } from "./match.ts";
import { inRulebookOrder } from "./rulebook.ts";

export const ORDER_ROOM = 20_000;

export interface OrderOptions {
  room?: number;
}

export type OrderCited =
  | { id: string; of: "decision"; group: string; state: DecisionState; text: string; accept?: string[]; changed?: string }
  | { id: string; of: "entry"; kind: EntryKind; title: string; text: string; changed?: string }
  | { id: string; of: "question"; question: string; meanwhile: string; answer?: { decision: string; said?: string; at: string } }
  | { id: string; of: "note"; from: string; text: string; changed?: string; cycle?: number }
  | { id: string; of: "review"; milestone: string; task: string; verdict: string; summary: string; cycle?: number }
  | { id: string; missing: string };

export interface OrderTask extends BriefTask {
  accept?: string[];
  cites?: string[];
}

export interface OrderBrief {
  level: "order";
  track: { name: string; handoff: HandoffNote | null; tasks: OrderTask[] };
  cited: OrderCited[];
  citedLeftOut?: { ids: string[]; read: string };
  rules: BriefRule[];
  entries: { id: string; kind: EntryKind; title: string }[];
  working: Working[];
  others: number;
  rulebook: Rulebook;
  cycle: { n: number };
}

const RULE: EntryKind = "rule";
const WITH_TEXT: readonly string[] = ["authority", "safety"];
const READ_WHOLE = "each is read whole by its id: decision_list, context_get, question_list, note_list or review_list, with cycle for one a closed cycle holds";
const EMPTY_DECISIONS: DecisionsFile = { schema: 1, decisions: [], replaced: [] };

export function applying(repo: Repo, track: string, inForce: readonly Entry[]): Entry[] {
  const area = repo.config.tracks.find((t) => t.name === track)?.paths;
  const isWithin = (entry: Entry): boolean => area === undefined || entry.paths.length === 0 || entry.paths.some((path) => area.some((within) => overlaps(path, within)));
  return inForce.filter((entry) => entry.kind !== RULE && isWithin(entry));
}

function orderTasks(ledger: Ledger, track: string, claims: readonly Claim[]): OrderTask[] {
  return ledger.milestones.flatMap((milestone) => milestone.tasks.filter((task) => task.track === track && task.commit === undefined).map((task): OrderTask => {
    const claim = claims.find((one) => one.milestone === milestone.id && one.task === task.id);
    const waits = waitsOf(task);
    return {
      milestone: milestone.id, id: task.id, ...(waits.length === 0 ? {} : { waits: waits.join("; ") }), ...(claim === undefined ? {} : { claimedBy: claim.agent }),
      ...(task.brief === undefined ? {} : { brief: task.brief }), ...(task.paths === undefined ? {} : { paths: task.paths }), ...(task.accept === undefined ? {} : { accept: task.accept }), ...(task.cites === undefined ? {} : { cites: task.cites }),
    };
  }));
}

function shaped(cited: Cited, decisions: DecisionsFile): OrderCited {
  const at = (cited.kind === "note" || cited.kind === "review") && cited.cycle !== undefined ? { cycle: cited.cycle } : {};
  if (cited.kind === "decision") {
    const { group, state, text, accept } = cited.record;
    const replaced = decisions.replaced.filter((row) => row.id === cited.id && row.group === group).at(-1);
    return { id: cited.id, of: "decision", group, state, text, ...(accept === undefined ? {} : { accept }), ...(replaced === undefined ? {} : { changed: `replaced ${replaced.replaced}: ${replaced.why}` }) };
  }
  if (cited.kind === "entry") {
    const { kind, title, text, retiredAt, retiredWhy } = cited.record;
    return { id: cited.id, of: "entry", kind, title, text, ...(retiredAt === undefined ? {} : { changed: `retired at ${retiredAt}${retiredWhy === undefined ? "" : `: ${retiredWhy}`}` }) };
  }
  if (cited.kind === "question") {
    const { question, meanwhile } = cited.record;
    const answered = "decision" in cited.record ? cited.record : undefined;
    return { id: cited.id, of: "question", question, meanwhile, ...(answered === undefined ? {} : { answer: { decision: answered.decision, ...(answered.said === undefined ? {} : { said: answered.said }), at: answered.answeredAt } }) };
  }
  if (cited.kind === "note") return { id: cited.id, of: "note", from: cited.record.from.track, text: cited.record.text, ...(cited.record.doneAt === undefined ? {} : { changed: `done at ${cited.record.doneAt}` }), ...at };
  const { milestone, task, verdict, summary } = cited.record;
  return { id: cited.id, of: "review", milestone, task, verdict, summary, ...at };
}

function inOrder(ids: readonly string[], lookup: Lookup, decisions: DecisionsFile): OrderCited[] {
  const unread = lookup.problems.length === 0 ? "no record has this id now" : `could not be read: ${lookup.problems.join("; ")}`;
  return ids.flatMap((id): OrderCited[] => {
    const found = lookup.found.filter((one) => one.id === id);
    return found.length === 0 ? [{ id, missing: unread }] : found.map((one) => shaped(one, decisions));
  });
}

function fitted(cited: readonly OrderCited[], rules: readonly BriefRule[], room: number): { cited: OrderCited[]; leftOut: string[] } {
  const sizes = cited.map((one) => JSON.stringify(one).length + 1);
  const fixed = JSON.stringify(rules).length + 2;
  const fits = sizes.reduce<number[]>((ends, size) => [...ends, (ends.at(-1) ?? fixed) + size], []).findIndex((end) => end > room);
  const kept = fits < 0 ? cited.length : fits;
  return { cited: cited.slice(0, kept), leftOut: [...new Set(cited.slice(kept).map((one) => one.id))] };
}

async function changedFiles(repo: Repo, rows: Awaited<ReturnType<typeof branches>>, branch: string): Promise<Set<string>> {
  const row = rows.find((one) => one.branch === branch);
  if (row === undefined) return new Set();
  const committed = row.isMain ? "" : ((await gitOut(repo.root, ["diff", "--name-only", `${repo.config.mainBranch}...${row.branch}`])) ?? "");
  return new Set([...row.files.map((file) => file.path), ...committed.split("\n").filter((line) => line !== "")]);
}

async function overlapping(repo: Repo, session: Session, claims: readonly Claim[]): Promise<{ working: Working[]; others: number }> {
  const others = (await listSessions(repo)).filter((one) => one.id !== session.id);
  const rows = await branches(repo.root, repo.config.mainBranch).catch(() => []);
  const mine = await changedFiles(repo, rows, session.branch);
  const shared = await Promise.all(others.map(async (one) => [...(await changedFiles(repo, rows, one.branch))].some((path) => mine.has(path))));
  const working = others.filter((_, index) => shared[index] === true).map((one): Working => {
    const claim = claims.find((held) => held.sessionId === one.id);
    return { track: one.track, agent: one.agent, since: one.openedAt, ...(claim === undefined ? {} : { task: `${claim.milestone} / ${claim.task}` }) };
  });
  return { working, others: others.length - working.length };
}

export async function orderBrief(repo: Repo, session: Session, options: OrderOptions = {}): Promise<OrderBrief> {
  const all = await readEntries(repo);
  const inForce = all.filter(isInForce);
  const claims = await listClaims(repo);
  const tasks = orderTasks(await new Records(repo).readLedger(), session.track, claims);
  const ids = [...new Set(tasks.flatMap((task) => task.cites ?? []))];
  const decisions = (await tolerated(readDecisions(repo), EMPTY_DECISIONS)).value;
  const citedIds = new Set(ids);
  const ruleEntries = inRulebookOrder(inForce.filter((entry) => entry.kind === RULE));
  const rules = ruleEntries.map(({ id, section, title, text }): BriefRule => ({ id, ...(section === undefined ? {} : { section }), title, ...(WITH_TEXT.includes(section ?? "") || citedIds.has(id) ? { text } : {}) }));
  const { cited, leftOut } = fitted(inOrder(ids, await findCited(repo, ids), decisions), rules, options.room ?? ORDER_ROOM);
  const handoff = await readHandoff(repo, session.track);
  const near = await overlapping(repo, session, claims);
  return {
    level: "order",
    track: { name: session.track, handoff: handoff.current ?? null, tasks },
    cited,
    ...(leftOut.length === 0 ? {} : { citedLeftOut: { ids: leftOut, read: READ_WHOLE } }),
    rules,
    entries: applying(repo, session.track, inForce).filter((entry) => !citedIds.has(entry.id)).map(({ id, kind, title }) => ({ id, kind, title })),
    ...near,
    rulebook: rulebookOf(all, ruleEntries.length),
    cycle: { n: (await readCycles(repo.recordsDir)).current },
  };
}
