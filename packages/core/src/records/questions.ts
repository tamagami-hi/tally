import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { commitRecords } from "./commit.ts";
import { parseTables, renderRow } from "./markdown.ts";

export const questionEditSchema = z.object({
  at: z.string(),
  by: z.string().min(1),
  question: z.string().min(1),
  meanwhile: z.string(),
  why: z.string().min(1),
});

export const questionSchema = z.object({
  row: z.number().int().positive(),
  group: z.string().min(1),
  question: z.string().min(1),
  meanwhile: z.string(),
  asked: z.string().optional(),
  by: z.string().optional(),
  track: z.string().optional(),
  edits: z.array(questionEditSchema).optional(),
});

export const answeredSchema = questionSchema.extend({ answeredAt: z.string(), decision: z.string() });
export const answeredRowsSchema = z.array(answeredSchema);

export const questionsFileSchema = z.object({
  schema: z.literal(1),
  nextRow: z.number().int().positive(),
  open: z.array(questionSchema).default([]),
  answered: z.array(answeredSchema).default([]),
});

export type Question = z.infer<typeof questionSchema>;
export type QuestionEdit = z.infer<typeof questionEditSchema>;
export type AnsweredQuestion = z.infer<typeof answeredSchema>;
export type QuestionsFile = z.infer<typeof questionsFileSchema>;

export const questionsPath = (repo: Repo): string => join(repo.recordsDir, "questions.json");

export const MOST_QUESTION_TEXT = 2000;
const ID = /^(?:[Qq]-)?0*([1-9]\d*)$/;

export const questionId = (row: number): string => `Q-${row}`;

export function rowOf(id: string | number): number {
  const found = ID.exec(String(id).trim());
  const row = found === null ? Number.NaN : Number(found[1]);
  if (!Number.isSafeInteger(row)) throw new TallyError(`'${id}' is not a question's id; give it as Q-24 or 24`);
  return row;
}

export function assertQuestionText(text: string, what: string): void {
  if (text.trim() === "") throw new TallyError(`${what} needs some text`);
  if (text.length > MOST_QUESTION_TEXT) throw new TallyError(`${what} holds at most ${MOST_QUESTION_TEXT} characters; this one has ${text.length}`);
}

export function parseQuestions(text: string, group: string): { open: Question[]; nextRow: number | null; lines: Map<number, { line: number; rendered: string }> } {
  const open: Question[] = [];
  const lines = new Map<number, { line: number; rendered: string }>();
  for (const table of parseTables(text)) {
    if (table.header[0] !== "#") continue;
    for (const { line, cells } of table.rows) {
      const [number = "", question = "", meanwhile = ""] = cells;
      const row = Number(number);
      if (!Number.isInteger(row)) continue;
      open.push({ row, group, question, meanwhile });
      lines.set(row, { line, rendered: renderRow([number, question, meanwhile]) });
    }
  }
  const next = /the next is (\d+)/.exec(text);
  return { open, nextRow: next === null ? null : Number(next[1]), lines };
}

export async function readQuestions(repo: Repo): Promise<QuestionsFile | null> {
  try {
    return await readJson(questionsPath(repo), questionsFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return null;
    throw error;
  }
}

export async function changeQuestions<R>(repo: Repo, change: (file: QuestionsFile) => { file: QuestionsFile; result: R }): Promise<R> {
  const path = questionsPath(repo);
  return withLock(path, async () => {
    const current = (await readQuestions(repo)) ?? { schema: 1, nextRow: 1, open: [], answered: [] };
    const { file, result } = change(current);
    await writeJsonAtomic(path, questionsFileSchema.parse(file));
    return result;
  });
}

export async function importQuestions(repo: Repo, file: string, group: string): Promise<{ open: number; nextRow: number; commit: string | null }> {
  const text = await readFile(file, "utf8");
  const parsed = parseQuestions(text, group);
  const original = text.split("\n");
  for (const [row, { line, rendered }] of parsed.lines) {
    if ((original[line - 1] ?? "").trim() !== rendered) throw new TallyError(`${file} line ${line} (row ${row}) does not render back as it is; refusing to import a lossy read`);
  }
  const nextRow = await changeQuestions(repo, (current) => {
    const highest = Math.max(current.nextRow, parsed.nextRow ?? 0, ...parsed.open.map((q) => q.row + 1));
    const open = [...current.open.filter((q) => q.group !== group), ...parsed.open].sort((a, b) => a.row - b.row);
    return { file: { ...current, nextRow: highest, open }, result: highest };
  });
  const commit = await commitRecords(repo, `import ${group}'s questions`);
  return { open: parsed.open.length, nextRow, commit };
}

export async function importAnswered(repo: Repo, rows: readonly AnsweredQuestion[]): Promise<{ answered: number; commit: string | null }> {
  await changeQuestions(repo, (current) => {
    const held = new Set([...current.open, ...current.answered].map((q) => q.row));
    for (const { row } of rows) {
      if (held.has(row)) throw new TallyError(`row ${row} is already in the record`);
      held.add(row);
    }
    const answered = [...current.answered, ...rows].sort((a, b) => a.row - b.row);
    return { file: { ...current, nextRow: Math.max(current.nextRow, ...rows.map((q) => q.row + 1)), answered }, result: undefined };
  });
  const commit = await commitRecords(repo, `import ${rows.length} answered questions`);
  return { answered: rows.length, commit };
}

export interface QuestionInput {
  group: string;
  question: string;
  meanwhile: string;
  by?: string;
  track?: string | undefined;
  number?: number | undefined;
}

const MOST_JUMP = 999;

function numbered(current: QuestionsFile, number: number | undefined, authority: { operator: boolean }): number {
  if (number === undefined) return current.nextRow;
  if (!authority.operator) throw new TallyError("only an operator session gives a question its number; leave number out and the next one is taken");
  if (number < current.nextRow) throw new TallyError(`the next question number is ${current.nextRow}; a number may jump forward, never back or to one used before`);
  if (number > current.nextRow + MOST_JUMP) throw new TallyError(`the next question number is ${current.nextRow}; a number may jump forward by at most ${MOST_JUMP} at once, so ${number} is refused as a slip`);
  return number;
}

export async function addQuestion(repo: Repo, input: QuestionInput, authority: { operator: boolean } = { operator: false }, now = new Date()): Promise<{ question: Question; id: string; commit: string | null }> {
  assertQuestionText(input.question, "a question");
  assertQuestionText(input.meanwhile, "a question's meanwhile");
  const question = await changeQuestions(repo, (current) => {
    const row = numbered(current, input.number, authority);
    const added: Question = { row, group: input.group, question: input.question, meanwhile: input.meanwhile, asked: now.toISOString(), ...(input.by === undefined ? {} : { by: input.by }), ...(input.track === undefined ? {} : { track: input.track }) };
    return { file: { ...current, nextRow: row + 1, open: [...current.open, added] }, result: added };
  });
  const commit = await commitRecords(repo, `${questionId(question.row)} (${input.group}) asked`);
  return { question, id: questionId(question.row), commit };
}

export async function answerQuestion(repo: Repo, row: number, decision: string, now = new Date()): Promise<{ question: Question; commit: string | null }> {
  const question = await changeQuestions(repo, (current) => {
    const found = current.open.find((q) => q.row === row);
    if (found === undefined) throw new TallyError(`no open question ${row}; open: ${current.open.map((q) => q.row).join(", ") || "none"}`);
    return { file: { ...current, open: current.open.filter((q) => q.row !== row), answered: [...current.answered, { ...found, answeredAt: now.toISOString(), decision }] }, result: found };
  });
  const commit = await commitRecords(repo, `${questionId(row)} answered: ${decision}`);
  return { question, commit };
}
