import { TallyError, namedList } from "../errors.ts";
import { andList } from "../phases/rows.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import type { Repo } from "../store/records.ts";
import { commitRecords } from "./commit.ts";
import { checkedSaid, isDisputed } from "./decision-record.ts";
import { changeDecisions, isWithdrawal, knownIn, readDecisions, stateFor, type Decision, type DecisionState, type DecisionsFile } from "./decisions.ts";
import { answerQuestion, rowOf, type Question } from "./questions.ts";

export interface StatusInput {
  id: string;
  group?: string | undefined;
  status: string;
  state?: DecisionState | undefined;
}

export interface AnswerInput {
  id: string | number;
  decision: string;
  said?: string | undefined;
}

const everyId = (file: DecisionsFile): string => namedList([...new Set(file.decisions.map((one) => one.id))]) || "none";

function oneDecision(file: DecisionsFile, id: string, group: string | undefined): Decision {
  const matching = file.decisions.filter((one) => one.id === id && (group === undefined || one.group === group));
  const [only, ...more] = matching;
  if (only === undefined) throw new TallyError(group === undefined ? `no decision ${id}; the decisions are ${everyId(file)}` : `${group} has no decision ${id}; its decisions are ${knownIn(file, group)}`);
  if (more.length > 0) throw new TallyError(`${id} is a decision of ${andList(matching.map((one) => one.group))}; give group`);
  return only;
}

export async function setStatusBySession(repo: Repo, session: Session, input: StatusInput, now = new Date()): Promise<{ decision: Decision; commit: string | null }> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session sets a decision's status; a track says what it built with task_land");
  const decision = await changeDecisions(repo, (file) => {
    const old = oneDecision(file, input.id, input.group);
    if (isDisputed(old) && !isWithdrawal(input.status)) throw new TallyError(`${old.id} (${old.group}) is disputed: it stops being disputed when it is replaced with decision_record, confirmed by the operator on the board, or withdrawn: a status that begins with withdrawn`);
    const next: Decision = { ...old, status: input.status, state: stateFor(input), by: "operator", on: now.toISOString(), statusVia: { session: session.id, track: session.track, agent: session.agent, at: now.toISOString() } };
    return { file: { ...file, decisions: file.decisions.map((one) => (one === old ? next : one)) }, result: next };
  });
  const commit = await commitRecords(repo, `decision ${decision.id} (${decision.group}): ${decision.status}`);
  return { decision, commit };
}

export async function answerWithDecision(repo: Repo, session: Session, input: AnswerInput, now = new Date()): Promise<{ question: Question; commit: string | null }> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session answers a question; a track adds what it knows with note_post");
  const row = rowOf(input.id);
  const said = input.said === undefined ? undefined : checkedSaid(input.said);
  const file = await readDecisions(repo);
  if (!file.decisions.some((one) => one.id === input.decision)) throw new TallyError(`no decision ${input.decision}; the decisions are ${everyId(file)}`);
  const via = { session: session.id, track: session.track, agent: session.agent };
  return answerQuestion(repo, row, input.decision, now, said === undefined ? { via } : { said, via });
}
