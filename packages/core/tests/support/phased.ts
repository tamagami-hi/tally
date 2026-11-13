import { addMilestone, plan } from "../../src/ledger/ops.ts";
import { queueFile } from "../../src/land/queue.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import type { Config } from "../../src/schema/config.ts";
import { opening, type Opening } from "./opening.ts";
import { sh } from "./repo.ts";

export const PHASE_RECORDS: Partial<Config["records"]> = { commit: true, batch: true, commitAt: "phase" };

export interface Phased extends Opening {
  count: () => Promise<number>;
}

export async function phased(records: Partial<Config["records"]> = PHASE_RECORDS): Promise<Phased> {
  const made = await opening(records);
  await sh(made.root, ["add", "-A", "docs/records"]);
  await sh(made.root, ["commit", "-q", "--allow-empty", "-m", "records: settle"]);
  return { ...made, count: async () => Number(await sh(made.root, ["rev-list", "--count", "HEAD"])) };
}

export async function milestoneIn(repo: Repo, stage: string, id: string, track: string, tasks: readonly string[]): Promise<void> {
  const records = new Records(repo);
  await records.update((ledger) => addMilestone(ledger, { id, stage, name: `${id} work`, track, weight: 1 }, [stage]));
  if (tasks.length > 0) await records.update((ledger) => plan(ledger, { milestone: id, track, tasks }));
}

export async function landedIn(repo: Repo, milestone: string): Promise<void> {
  await new Records(repo).update((ledger) => ({
    ledger: { ...ledger, milestones: ledger.milestones.map((one) => (one.id === milestone ? { ...one, tasks: one.tasks.map((task) => (task.status === "landed" ? task : { ...task, status: "landed" as const, commit: "abc1234" })) } : one)) },
    message: `${milestone} landed`,
  }));
}

export async function queued(repo: Repo, track: string, state: "queued" | "turn" = "queued"): Promise<string> {
  const id = `t-${track}`;
  await queueFile(repo).update((queue) => ({ value: { tickets: [...queue.tickets, { id, sessionId: "s1", track, agent: "sonnet", worktree: "/x", files: [], state, since: "2026-11-14T09:00:00.000Z", attempts: 0 }] }, result: undefined }));
  return id;
}
