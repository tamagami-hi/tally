import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { questionId, readQuestions, rowOf } from "./questions.ts";

export async function underOf(repo: Repo, given: readonly string[]): Promise<string[]> {
  const open = ((await readQuestions(repo))?.open ?? []).map((question) => question.row);
  const ids = [...new Set(given.map((id) => questionId(rowOf(id))))];
  const shut = ids.find((id) => !open.includes(rowOf(id)));
  if (shut !== undefined) throw new TallyError(`${shut} is not an open question; open: ${open.map(questionId).join(", ") || "none"}`);
  return ids;
}
