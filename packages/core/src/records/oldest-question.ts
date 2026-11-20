import type { Repo } from "../store/records.ts";
import { questionId, readQuestions } from "./questions.ts";

export const NUDGE_DAYS = 2;
const DAY_MS = 86_400_000;

export interface OldestQuestion {
  id: string;
  days: number;
}

export async function oldestQuestion(repo: Repo, now = new Date()): Promise<OldestQuestion | undefined> {
  const nudge = (repo.config.questions?.nudgeDays ?? NUDGE_DAYS) * DAY_MS;
  const aged = ((await readQuestions(repo))?.open ?? []).flatMap((question) => (question.asked === undefined ? [] : [{ id: questionId(question.row), age: now.getTime() - Date.parse(question.asked) }]));
  const oldest = aged.filter((one) => one.age > nudge).sort((a, b) => b.age - a.age)[0];
  return oldest === undefined ? undefined : { id: oldest.id, days: Math.floor(oldest.age / DAY_MS) };
}
