import { TallyError } from "../errors.ts";
import { commitRecords } from "../records/commit.ts";
import type { PhaseRecord } from "../schema/phases.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import type { Repo } from "../store/records.ts";
import { changePhases } from "./file.ts";
import { andList, phaseRows } from "./rows.ts";

export interface PhaseInput {
  id: string;
  name: string;
  goal: string;
  weight: number;
  decision?: string | undefined;
}

export const PHASE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
export const MOST_PHASE_NAME = 80;
export const MOST_PHASE_GOAL = 500;
export const MOST_DECISION = 200;

function checked(input: PhaseInput): PhaseInput {
  const name = input.name.trim();
  const goal = input.goal.trim();
  const decision = input.decision?.trim();
  if (!PHASE_ID.test(input.id)) throw new TallyError(`a phase's id is 1 to 40 letters, digits, - or _, and starts with a letter or a digit: '${input.id}'`);
  if (name === "" || name.length > MOST_PHASE_NAME) throw new TallyError(`a phase needs a name of 1 to ${MOST_PHASE_NAME} characters`);
  if (goal === "" || goal.length > MOST_PHASE_GOAL) throw new TallyError(`a phase needs a goal, one sentence of 1 to ${MOST_PHASE_GOAL} characters`);
  if (!Number.isInteger(input.weight) || input.weight <= 0) throw new TallyError(`a phase's weight is a positive whole number, its share of the build's progress, not ${input.weight}`);
  if (decision !== undefined && (decision === "" || decision.length > MOST_DECISION)) throw new TallyError(`a phase's decision is the id of the decision that approved it, 1 to ${MOST_DECISION} characters`);
  return { id: input.id, name, goal, weight: input.weight, ...(decision === undefined ? {} : { decision }) };
}

export async function addPhase(repo: Repo, session: Pick<Session, "track" | "agent">, input: PhaseInput, now = new Date()): Promise<{ phase: PhaseRecord; commit: string | null }> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session adds a phase; a track that wants one asks a question with question_add");
  const given = checked(input);
  const phase = await changePhases(repo.recordsDir, async (file) => {
    const ids = (await phaseRows(repo)).map((row) => row.id);
    if (ids.includes(given.id)) throw new TallyError(`phase ${given.id} exists; the phases are ${andList(ids)}`);
    const added: PhaseRecord = { ...given, openedAt: now.toISOString(), openedBy: { track: session.track, agent: session.agent } };
    return { file: { ...file, phases: [...file.phases, added] }, result: added };
  });
  const commit = await commitRecords(repo, `phase ${phase.id} added by ${session.agent}`);
  return { phase, commit };
}
