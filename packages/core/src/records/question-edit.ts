import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { commitRecords } from "./commit.ts";
import { assertQuestionText, changeQuestions, questionId, rowOf, type Question, type QuestionsFile } from "./questions.ts";

export const MOST_EDIT_WHY = 200;

export interface Editor {
  agent: string;
  track?: string;
  operator: boolean;
}

export interface QuestionEditInput {
  id: string | number;
  question?: string | undefined;
  meanwhile?: string | undefined;
  why: string;
}

function assertInput(input: QuestionEditInput): void {
  if (input.question === undefined && input.meanwhile === undefined) throw new TallyError("an edit gives the question, the meanwhile, or both");
  if (input.question !== undefined) assertQuestionText(input.question, "a question");
  if (input.meanwhile !== undefined) assertQuestionText(input.meanwhile, "a question's meanwhile");
  const why = input.why.trim();
  if (why === "") throw new TallyError("an edit needs a why, in a line");
  if (why.includes("\n")) throw new TallyError("an edit's why is one line; say it in a line");
  if (why.length > MOST_EDIT_WHY) throw new TallyError(`an edit's why holds at most ${MOST_EDIT_WHY} characters; this one has ${why.length}`);
}

function openOne(file: QuestionsFile, row: number): Question {
  const open = file.open.find((one) => one.row === row);
  if (open !== undefined) return open;
  const answered = file.answered.find((one) => one.row === row);
  if (answered !== undefined) throw new TallyError(`${questionId(row)} was answered on ${answered.answeredAt} (${answered.decision}); ask a new question that names it`);
  throw new TallyError(`no question ${questionId(row)}; question_list shows the open ones`);
}

function assertMayEdit(editor: Editor, question: Question): void {
  if (editor.operator) return;
  const id = questionId(question.row);
  if (question.by === undefined || question.track === undefined) throw new TallyError(`only an operator session edits ${id}; ask a new question that names it`);
  if (question.by === editor.agent && question.track === editor.track) return;
  throw new TallyError(`only an operator session or ${question.by} on track ${question.track}, who asked ${id}, edits it; ask a new question that names it`);
}

export async function editQuestion(repo: Repo, editor: Editor, input: QuestionEditInput, now = new Date()): Promise<{ question: Question; id: string; commit: string | null }> {
  assertInput(input);
  const row = rowOf(input.id);
  const why = input.why.trim();
  const question = await changeQuestions(repo, (file) => {
    const found = openOne(file, row);
    assertMayEdit(editor, found);
    const kept = { at: now.toISOString(), by: editor.agent, question: found.question, meanwhile: found.meanwhile, why };
    const edited: Question = { ...found, question: input.question ?? found.question, meanwhile: input.meanwhile ?? found.meanwhile, edits: [...(found.edits ?? []), kept] };
    return { file: { ...file, open: file.open.map((one) => (one.row === row ? edited : one)) }, result: edited };
  });
  const commit = await commitRecords(repo, `${questionId(row)} edited: ${why}`);
  return { question, id: questionId(row), commit };
}
