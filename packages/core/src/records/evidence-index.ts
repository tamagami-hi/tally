import type { Repo } from "../store/records.ts";
import { readAllEvidence, type RunRecord } from "./evidence.ts";
import { readAllManual, type ManualCheck } from "./manual.ts";

export interface IndexedMilestone {
  milestone: string;
  records: RunRecord[];
  manual?: ManualCheck[];
}

export async function evidenceIndex(repo: Repo): Promise<IndexedMilestone[]> {
  const runs = await readAllEvidence(repo);
  const checks = new Map((await readAllManual(repo)).map((file) => [file.milestone, file.checks]));
  const ids = [...new Set([...runs.map((one) => one.milestone), ...checks.keys()])].sort();
  return ids.map((milestone) => {
    const manual = checks.get(milestone) ?? [];
    return { milestone, records: runs.find((one) => one.milestone === milestone)?.records ?? [], ...(manual.length === 0 ? {} : { manual }) };
  });
}
