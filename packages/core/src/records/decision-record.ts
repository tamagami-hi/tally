import { TallyError, namedList } from "../errors.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import type { Repo } from "../store/records.ts";
import { commitRecords } from "./commit.ts";
import { checkedAccept } from "./accept.ts";
import { changeDecisions, isWithdrawn, knownIn, stateFor, type Decision, type DecisionState, type DecisionsFile, type Replaced } from "./decisions.ts";

export { isWithdrawn };

export const MOST_SAID = 2000;

export interface RecordInput {
  group: string;
  text: string;
  said: string;
  id?: string | undefined;
  section?: string | undefined;
  status?: string | undefined;
  state?: DecisionState | undefined;
  replaces?: { why: string } | undefined;
  accept?: readonly string[] | undefined;
  paths?: readonly string[] | undefined;
}

export interface Recorded {
  decision: Decision;
  replaced?: Replaced;
  commit: string | null;
}

export type Mark = "confirm" | "dispute";

const DEC_FORM = /^DEC-(\d+)$/;
const DAY = 10;
const IN_FORCE = "in force";

export const isUnconfirmed = (decision: Decision): boolean => decision.via !== undefined && decision.confirmed === undefined;


export const isDisputed = (decision: Decision): boolean => decision.disputed !== undefined && !isWithdrawn(decision);

export interface DecisionMarks {
  unconfirmed?: true;
  disputed?: true;
}

export function marksOf(decision: Decision): DecisionMarks {
  if (isWithdrawn(decision)) return {};
  if (isDisputed(decision)) return { disputed: true };
  return isUnconfirmed(decision) ? { unconfirmed: true } : {};
}

export interface ToConfirm {
  id: string;
  group: string;
  text: string;
  said: string;
  via: { session: string; track: string; agent: string };
  on?: string;
  disputed?: true;
}

export interface Confirming {
  unconfirmed: number;
  disputed: string[];
}

export const toConfirm = (file: DecisionsFile): ToConfirm[] => file.decisions.flatMap((one): ToConfirm[] => (one.via === undefined || one.confirmed !== undefined || isWithdrawn(one) ? [] : [{
  id: one.id, group: one.group, text: one.text, said: one.said ?? "", via: one.via, ...(one.on === undefined ? {} : { on: one.on }), ...(isDisputed(one) ? { disputed: true as const } : {}),
}]));

export const confirmingOf = (file: DecisionsFile): Confirming => ({ unconfirmed: toConfirm(file).length, disputed: file.decisions.filter(isDisputed).map((one) => one.id) });

export const disputedProblems = (file: DecisionsFile): string[] => file.decisions.filter(isDisputed).map((one) => `decision ${one.id} (${one.group}) is disputed: the operator said it is not their word; replace it with decision_record, or set its status to withdrawn`);

export function assertOperatorRecords(repo: Repo, session: Pick<Session, "track">): void {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session records a decision, with the operator's own words in said; a track that needs one decided asks with question_add");
}

export function checkedSaid(said: string): string {
  const words = said.trim();
  if (words === "") throw new TallyError("a decision needs the operator's own words in said");
  if (said.length > MOST_SAID) throw new TallyError(`said holds at most ${MOST_SAID} characters; this one has ${said.length}`);
  return said;
}

function nextId(file: DecisionsFile, group: string): string {
  const odd = file.decisions.filter((one) => one.group === group && !DEC_FORM.test(one.id)).map((one) => one.id);
  if (odd.length > 0) throw new TallyError(`${group}'s decision ids are not all DEC-<n> (${namedList(odd)}), so give the id`);
  const highest = Math.max(0, ...file.decisions.map((one) => Number(DEC_FORM.exec(one.id)?.[1] ?? 0)));
  return `DEC-${highest + 1}`;
}

function written(input: RecordInput, id: string, old: Decision | undefined, session: Session, now: Date): Decision {
  const status = input.status ?? input.state ?? IN_FORCE;
  const section = input.section ?? old?.section;
  const accept = input.accept ?? old?.accept;
  const paths = input.paths ?? old?.paths;
  return {
    id, group: input.group, ...(section === undefined ? {} : { section }), ...(accept === undefined || accept.length === 0 ? {} : { accept: [...accept] }), ...(paths === undefined || paths.length === 0 ? {} : { paths: [...paths] }), text: input.text, since: now.toISOString().slice(0, DAY), status, state: stateFor({ status, state: input.state }),
    by: "operator", on: now.toISOString(), said: input.said, via: { session: session.id, track: session.track, agent: session.agent },
  };
}

function placed(file: DecisionsFile, input: RecordInput, session: Session, now: Date): { file: DecisionsFile; result: Omit<Recorded, "commit"> } {
  const id = input.id ?? nextId(file, input.group);
  const old = file.decisions.find((one) => one.group === input.group && one.id === id);
  const alike = file.decisions.find((one) => one.group === input.group && one.id !== id && one.id.toLowerCase() === id.toLowerCase());
  if (alike !== undefined) throw new TallyError(`${input.group} already has decision ${alike.id}, which ${id} differs from only by letter case; give ${alike.id} with replaces to replace it, or another id`);
  if (old !== undefined && input.replaces === undefined) throw new TallyError(`${input.group} already has decision ${id}; give replaces with why to replace it`);
  if (old === undefined && input.replaces !== undefined) throw new TallyError(`${input.group} has no decision ${id} to replace; its decisions are ${knownIn(file, input.group)}`);
  const decision = written(input, id, old, session, now);
  if (old === undefined || input.replaces === undefined) return { file: { ...file, decisions: [...file.decisions, decision] }, result: { decision } };
  const replaced: Replaced = { id, group: input.group, was: old.text, replaced: `${now.toISOString().slice(0, DAY)}, by ${id}`, why: input.replaces.why };
  return { file: { ...file, decisions: file.decisions.map((one) => (one === old ? decision : one)), replaced: [...file.replaced, replaced] }, result: { decision, replaced } };
}

export async function recordDecision(repo: Repo, session: Session, input: RecordInput, now = new Date()): Promise<Recorded> {
  assertOperatorRecords(repo, session);
  const said = checkedSaid(input.said);
  if (input.text.trim() === "") throw new TallyError("a decision needs its text");
  if (input.accept !== undefined) checkedAccept(input.accept);
  const result = await changeDecisions(repo, (file) => placed(file, { ...input, said }, session, now));
  const { id, group } = result.decision;
  const commit = await commitRecords(repo, `decision ${id} (${group}) ${result.replaced === undefined ? "recorded" : "replaced"} by ${session.agent}, on the operator's word`);
  return { ...result, commit };
}

export async function markDecision(repo: Repo, ref: { group: string; id: string }, mark: Mark, now = new Date()): Promise<{ decision: Decision; commit: string | null }> {
  const decision = await changeDecisions(repo, (file) => {
    const old = file.decisions.find((one) => one.group === ref.group && one.id === ref.id);
    if (old === undefined) throw new TallyError(`${ref.group} has no decision ${ref.id}; its decisions are ${knownIn(file, ref.group)}`);
    if (old.via === undefined) throw new TallyError(`decision ${ref.id} (${ref.group}) was not recorded through decision_record, so it needs no confirming`);
    const { confirmed: _confirmed, disputed: _disputed, ...rest } = old;
    const next: Decision = mark === "confirm" ? { ...rest, confirmed: { at: now.toISOString() } } : { ...rest, disputed: { at: now.toISOString() } };
    return { file: { ...file, decisions: file.decisions.map((one) => (one === old ? next : one)) }, result: next };
  });
  const commit = await commitRecords(repo, `decision ${ref.id} (${ref.group}) ${mark === "confirm" ? "confirmed" : "disputed"} by the operator`);
  return { decision, commit };
}
