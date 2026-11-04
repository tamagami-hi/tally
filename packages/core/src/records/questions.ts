import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { commitRecords } from "./commit.ts";
import { parseTables, renderRow } from "./markdown.ts";

export const questionSchema = z.object({
  row: z.number().int().positive(),
  group: z.string().min(1),
  question: z.string().min(1),
  meanwhile: z.string(),
  asked: z.string().optional(),
  by: z.string().optional(),
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
export type AnsweredQuestion = z.infer<typeof answeredSchema>;
export type QuestionsFile = z.infer<typeof questionsFileSchema>;

export const questionsPath = (repo: Repo): string => join(repo.recordsDir, "questions.json");

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

async function update<R>(repo: Repo, change: (file: QuestionsFile) => { file: QuestionsFile; result: R }): Promise<R> {
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
  const nextRow = await update(repo, (current) => {
    const highest = Math.max(current.nextRow, parsed.nextRow ?? 0, ...parsed.open.map((q) => q.row + 1));
    const open = [...current.open.filter((q) => q.group !== group), ...parsed.open].sort((a, b) => a.row - b.row);
    return { file: { ...current, nextRow: highest, open }, result: highest };
  });
  const commit = await commitRecords(repo, `import ${group}'s questions`);
  return { open: parsed.open.length, nextRow, commit };
}

export async function importAnswered(repo: Repo, rows: readonly AnsweredQuestion[]): Promise<{ answered: number; commit: string | null }> {
  await update(repo, (current) => {
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

export async function addQuestion(repo: Repo, input: { group: string; question: string; meanwhile: string; by?: string }, now = new Date()): Promise<{ question: Question; commit: string | null }> {
  const question = await update(repo, (current) => {
    const added: Question = { row: current.nextRow, group: input.group, question: input.question, meanwhile: input.meanwhile, asked: now.toISOString(), ...(input.by === undefined ? {} : { by: input.by }) };
    return { file: { ...current, nextRow: current.nextRow + 1, open: [...current.open, added] }, result: added };
  });
  const commit = await commitRecords(repo, `question ${question.row} (${input.group}) asked`);
  return { question, commit };
}

export async function answerQuestion(repo: Repo, row: number, decision: string, now = new Date()): Promise<{ question: Question; commit: string | null }> {
  const question = await update(repo, (current) => {
    const found = current.open.find((q) => q.row === row);
    if (found === undefined) throw new TallyError(`no open question ${row}; open: ${current.open.map((q) => q.row).join(", ") || "none"}`);
    return { file: { ...current, open: current.open.filter((q) => q.row !== row), answered: [...current.answered, { ...found, answeredAt: now.toISOString(), decision }] }, result: found };
  });
  const commit = await commitRecords(repo, `question ${row} answered: ${decision}`);
  return { question, commit };
}
