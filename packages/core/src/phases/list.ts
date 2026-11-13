import { MOST_LEFT, blockersOf, contextOf, tasksOf } from "./blockers.ts";
import { Records, type Repo } from "../store/records.ts";
import { isClosed, phaseRows } from "./rows.ts";

export interface PhaseListed {
  id: string;
  name: string;
  goal?: string;
  decision?: string;
  state: "open" | "closed";
  closedAt?: string;
  summary?: string;
  tasks: { total: number; landed: number };
  left: string[];
}

export interface PhaseFilter {
  state?: "open" | "closed" | undefined;
}

export async function listPhases(repo: Repo, filter: PhaseFilter): Promise<PhaseListed[]> {
  const ledger = await new Records(repo).readLedger();
  const rows = await phaseRows(repo);
  const context = await contextOf(repo, ledger);
  const listed = rows.map((row): PhaseListed => {
    const { total, landed } = tasksOf(ledger, row.id);
    return {
      id: row.id,
      name: row.name,
      ...(row.goal === undefined ? {} : { goal: row.goal }),
      ...(row.decision === undefined ? {} : { decision: row.decision }),
      state: isClosed(row) ? "closed" : "open",
      ...(row.closedAt === undefined ? {} : { closedAt: row.closedAt }),
      ...(row.summary === undefined ? {} : { summary: row.summary }),
      tasks: { total, landed },
      left: isClosed(row) ? [] : blockersOf(context, ledger, row.id).slice(0, MOST_LEFT),
    };
  });
  return filter.state === undefined ? listed : listed.filter((phase) => phase.state === filter.state);
}
