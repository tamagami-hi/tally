import { addDecision } from "../../src/records/decisions.ts";
import type { Deferred } from "../../src/schema/ledger.ts";
import { openSession, type Session } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { makeTracked, type Tracked } from "./tracked.ts";

export interface Parking extends Tracked {
  operator: Session;
  data: Session;
  engine: Session;
}

export async function withParts(repo: Repo, milestone: string, task: string, deferred: Deferred[]): Promise<void> {
  await new Records(repo).update((ledger) => ({
    ledger: { ...ledger, milestones: ledger.milestones.map((one) => (one.id !== milestone ? one : { ...one, tasks: one.tasks.map((t) => (t.id === task ? { ...t, deferred } : t)) })) },
    message: "parts",
  }));
}

export async function parking(): Promise<Parking> {
  const tracked = await makeTracked();
  await addDecision(tracked.repo, { id: "DEC-14", group: "platform", text: "Small leftovers wait for the polish phase.", since: "2026-11-10", status: "in force" }, { operator: true });
  await withParts(tracked.repo, "B2", "done", [{ what: "the docs", to: "B2:4 manifest" }, { what: "the cache" }]);
  return {
    ...tracked,
    operator: await openSession(tracked.repo, { worktree: tracked.root, agent: "operator" }),
    data: await openSession(tracked.repo, { worktree: tracked.trees["data"]!, agent: "claude" }),
    engine: await openSession(tracked.repo, { worktree: tracked.trees["engine"]!, agent: "kiro" }),
  };
}
