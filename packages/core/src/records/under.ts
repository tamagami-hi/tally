import { TallyError } from "../errors.ts";
import type { Ledger } from "../schema/ledger.ts";
import { Records, type Repo } from "../store/records.ts";
import { closedLedgersByCycle } from "./cited.ts";
import { questionId, readQuestions, rowOf } from "./questions.ts";

export async function underOf(repo: Repo, given: readonly string[]): Promise<string[]> {
  const open = ((await readQuestions(repo))?.open ?? []).map((question) => question.row);
  const ids = [...new Set(given.map((id) => questionId(rowOf(id))))];
  const shut = ids.find((id) => !open.includes(rowOf(id)));
  if (shut !== undefined) throw new TallyError(`${shut} is not an open question; open: ${open.map(questionId).join(", ") || "none"}`);
  return ids;
}

const tasksUnder = (ledger: Ledger, id: string, cycle?: number): string[] =>
  ledger.milestones.flatMap((milestone) => milestone.tasks.filter((task) => (task.under ?? []).includes(id)).map((task) => `${milestone.id} '${task.id}'${cycle === undefined ? "" : ` (cycle ${cycle})`}`));

export async function builtUnder(repo: Repo, id: string): Promise<string[]> {
  const closed = await closedLedgersByCycle(repo);
  return [...tasksUnder(await new Records(repo).readLedger(), id), ...closed.ledgers.flatMap(({ n, ledger }) => tasksUnder(ledger, id, n))];
}
