import { waitsOf } from "../ledger/waits.ts";
import { readHandoff, type HandoffNote } from "../records/handoffs.ts";
import { readQuestions } from "../records/questions.ts";
import { NO_CHECK } from "../repos/start.ts";
import type { Ledger, Task } from "../schema/ledger.ts";
import { listClaims, type Claim } from "../state/claims.ts";
import { listSessions, type Session } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import { readEntries, type Entry, type EntryKind } from "./entries.ts";
import { isInForce } from "./find.ts";
import { overlaps } from "./match.ts";
import { readProject, type Project } from "./project.ts";

export interface BriefTask {
  milestone: string;
  id: string;
  waits?: string;
  claimedBy?: string;
  brief?: string;
  paths?: string[];
}

export interface Working {
  track: string;
  agent: string;
  since: string;
  task?: string;
}

export interface Brief {
  project: Project;
  rules: Entry[];
  track: { name: string; tasks: BriefTask[]; handoff: HandoffNote | null };
  entries: { id: string; kind: EntryKind; title: string }[];
  working: Working[];
  openQuestions: number;
  missing: string[];
}

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

export async function sessionBrief(repo: Repo, session: Session): Promise<Brief> {
  const project = await readProject(repo);
  const inForce = (await readEntries(repo)).filter(isInForce);
  const claims = await listClaims(repo);
  const handoff = await readHandoff(repo, session.track);
  return {
    project,
    rules: inForce.filter((entry) => entry.kind === RULE),
    track: { name: session.track, tasks: unlandedTasks(await new Records(repo).readLedger(), session.track, claims), handoff: handoff.current ?? null },
    entries: applying(repo, session.track, inForce).map(({ id, kind, title }) => ({ id, kind, title })),
    working: working(await listSessions(repo), claims, session),
    openQuestions: (await readQuestions(repo))?.open.length ?? 0,
    missing: missingFrom(repo, project, inForce),
  };
}
