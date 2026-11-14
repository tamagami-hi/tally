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
import { overlaps } from "./match.ts";
import { readProject, type Project } from "./project.ts";
import { inRulebookOrder, waitingRules } from "./rulebook.ts";
import { recordsWaiting } from "../records/waiting.ts";
import { checkoutState } from "../land/operator.ts";
import { atLevel, landing, rulebookOf, type Brief, type BriefLevel, type BriefRule, type BriefTask, type FullBrief, type Tailoring, type Working } from "./brief-level.ts";

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

function applying(repo: Repo, track: string, inForce: readonly Entry[]): Entry[] {
  const area = repo.config.tracks.find((t) => t.name === track)?.paths;
  const isWithin = (entry: Entry): boolean => area === undefined || entry.paths.length === 0 || entry.paths.some((path) => area.some((within) => overlaps(path, within)));
  return inForce.filter((entry) => entry.kind !== RULE && isWithin(entry));
}

const slim = ({ id, section, title, text }: Entry): BriefRule => ({ id, ...(section === undefined ? {} : { section }), title, text });

function tailoringOf(repo: Repo, session: Session, rules: readonly Entry[]): { tailoring?: Tailoring[] } {
  const waiting = inRulebookOrder(waitingRules(rules));
  if (!isOperator(repo, session) || waiting.length === 0) return {};
  return { tailoring: waiting.map(({ id, title, tailor }) => ({ id, title, tailor: tailor ?? "" })) };
}

export type { Brief, BriefLevel, BriefRule, BriefTask, Tailoring, Working } from "./brief-level.ts";

export async function sessionBrief(repo: Repo, session: Session, level: BriefLevel = "full"): Promise<Brief> {
  const all = await readEntries(repo);
  const inForce = all.filter(isInForce);
  const claims = await listClaims(repo);
  const rules = inForce.filter((entry) => entry.kind === RULE);
  const operator = isOperator(repo, session) ? { recordsWaiting: await recordsWaiting(repo), checkout: await checkoutState(repo) } : {};
  const tasks = unlandedTasks(await new Records(repo).readLedger(), session.track, claims);
  const shared = { rulebook: rulebookOf(all, rules.length), ...operator, working: working(await listSessions(repo), claims, session) };
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
