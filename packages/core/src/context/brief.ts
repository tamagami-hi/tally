import { waitsOf } from "../ledger/waits.ts";
import { readHandoff } from "../records/handoffs.ts";
import { readQuestions } from "../records/questions.ts";
import { NO_CHECK } from "../repos/start.ts";
import type { Ledger, Task } from "../schema/ledger.ts";
import { listClaims, type Claim } from "../state/claims.ts";
import { isOperator, listSessions, type Session } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import { readEntries, type Entry, type EntryKind } from "./entries.ts";
import { isInForce } from "./find.ts";
import { applying, orderBrief, type OrderBrief, type OrderOptions } from "./order.ts";
import { readProject, type Project } from "./project.ts";
import { inRulebookOrder, waitingRules } from "./rulebook.ts";
import { recordsWaiting } from "../records/waiting.ts";
import { checkoutState } from "../land/operator.ts";
import { atLevel, type BriefCycle, landing, rulebookOf, type Brief, type BriefLevel, type BriefRule, type BriefTask, type FullBrief, type Tailoring, type Working } from "./brief-level.ts";
import { readCycles } from "../cycles/file.ts";
import { isComplete } from "../cycles/list.ts";
import { askOf } from "../cycles/state.ts";
import { decisionsToMark, type ToMark } from "../records/cited.ts";
import { confirmingOf } from "../records/decision-record.ts";
import { readDecisions } from "../records/decisions.ts";

type Told = Task & { brief?: unknown; paths?: unknown };

const RULE: EntryKind = "rule";
const NEEDED_KINDS: readonly EntryKind[] = ["area", "howto", RULE];

export const NO_PURPOSE = "no project purpose";
export const NO_CHECK_SET = "no check is set";

const isText = (value: unknown): value is string => typeof value === "string";

function briefTask(milestone: string, task: Told, claims: readonly Claim[]): BriefTask {
  const claim = claims.find((c) => c.milestone === milestone && c.task === task.id);
  return {
    milestone,
    id: task.id,
    ...(waitsOf(task).length === 0 ? {} : { waits: waitsOf(task).join("; ") }),
    ...(claim === undefined ? {} : { claimedBy: claim.agent }),
    ...(isText(task.brief) ? { brief: task.brief } : {}),
    ...(Array.isArray(task.paths) ? { paths: task.paths.filter(isText) } : {}),
  };
}

export function unlandedTasks(ledger: Ledger, track: string, claims: readonly Claim[]): BriefTask[] {
  return ledger.milestones.flatMap((m) => m.tasks.filter((task) => task.track === track && task.commit === undefined).map((task) => briefTask(m.id, task, claims)));
}

function working(sessions: readonly Session[], claims: readonly Claim[], self: Session): Working[] {
  return sessions.filter((other) => other.id !== self.id).map((other) => {
    const claim = claims.find((c) => c.sessionId === other.id);
    return { track: other.track, agent: other.agent, since: other.openedAt, ...(claim === undefined ? {} : { task: `${claim.milestone} / ${claim.task}` }) };
  });
}

const isSameCommand = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((part, index) => part === b[index]);

export function missingFrom(repo: Repo, project: Project, inForce: readonly Entry[]): string[] {
  return [
    ...(project.purpose.trim() === "" ? [NO_PURPOSE] : []),
    ...(isSameCommand(repo.config.commands.test, NO_CHECK) ? [NO_CHECK_SET] : []),
    ...NEEDED_KINDS.filter((kind) => !inForce.some((entry) => entry.kind === kind)).map((kind) => `no ${kind}`),
  ];
}

const slim = ({ id, section, title, text }: Entry): BriefRule => ({ id, ...(section === undefined ? {} : { section }), title, text });

function tailoringOf(repo: Repo, session: Session, rules: readonly Entry[]): { tailoring?: Tailoring[] } {
  const waiting = inRulebookOrder(waitingRules(rules));
  if (!isOperator(repo, session) || waiting.length === 0) return {};
  return { tailoring: waiting.map(({ id, title, tailor }) => ({ id, title, tailor: tailor ?? "" })) };
}

async function briefCycle(repo: Repo, session: Session, ledger: Ledger): Promise<BriefCycle> {
  const n = (await readCycles(repo.recordsDir)).current;
  if (!isOperator(repo, session)) return { n };
  const complete = await isComplete(repo, ledger, n);
  return { n, complete, ...(complete ? { ask: askOf(n) } : {}) };
}

async function marking(repo: Repo): Promise<{ decisionsToMark?: ToMark[] }> {
  const marked = await decisionsToMark(repo);
  return marked.length === 0 ? {} : { decisionsToMark: marked };
}

export type { Brief, BriefCycle, BriefLevel, BriefRule, BriefTask, Tailoring, Working } from "./brief-level.ts";

export async function sessionBrief(repo: Repo, session: Session, level: BriefLevel = "full", options: OrderOptions = {}): Promise<Brief | OrderBrief> {
  if (level === "order") return isOperator(repo, session) ? { ...(await sessionBrief(repo, session, "work")), asked: "order" } : orderBrief(repo, session, options);
  const all = await readEntries(repo);
  const inForce = all.filter(isInForce);
  const claims = await listClaims(repo);
  const rules = inForce.filter((entry) => entry.kind === RULE);
  const operator = isOperator(repo, session) ? { recordsWaiting: await recordsWaiting(repo), checkout: await checkoutState(repo), decisions: confirmingOf(await readDecisions(repo)), ...(await marking(repo)) } : {};
  const ledger = await new Records(repo).readLedger();
  const tasks = unlandedTasks(ledger, session.track, claims);
  const cycle = await briefCycle(repo, session, ledger);
  const shared = { rulebook: rulebookOf(all, rules.length), ...operator, cycle, working: working(await listSessions(repo), claims, session) };
  if (level === "land") return { level, ...shared, track: { name: session.track, tasks: tasks.map(landing) } };
  const project = await readProject(repo);
  const handoff = await readHandoff(repo, session.track);
  const full: FullBrief = {
    level: "full",
    project,
    rules: inRulebookOrder(rules).map(slim),
    ...tailoringOf(repo, session, rules),
    ...shared,
    track: { name: session.track, tasks, handoff: handoff.current ?? null },
    entries: applying(repo, session.track, inForce).map(({ id, kind, title }) => ({ id, kind, title })),
    openQuestions: (await readQuestions(repo))?.open.length ?? 0,
    missing: missingFrom(repo, project, inForce),
  };
  return atLevel(full, level, repo.config.name);
}
