import { reopenRepo, type Repo } from "../store/records.ts";
import type { PhaseRecord } from "../schema/phases.ts";
import { readPhases } from "./file.ts";

export interface PhaseRow extends PhaseRecord {
  name: string;
  weight: number;
}

export const isClosed = (phase: Pick<PhaseRecord, "closedAt">): boolean => phase.closedAt !== undefined;

export function andList(ids: readonly string[]): string {
  if (ids.length < 2) return ids.join("");
  return `${ids.slice(0, -1).join(", ")} and ${ids.at(-1) ?? ""}`;
}

export async function phaseRows(repo: Repo): Promise<PhaseRow[]> {
  const fresh = await reopenRepo(repo);
  const { phases } = await readPhases(fresh.recordsDir);
  return fresh.config.stages.map((stage) => {
    const record = phases.find((one) => one.id === stage.id);
    return { ...record, id: stage.id, name: stage.name, weight: stage.weight };
  });
}
