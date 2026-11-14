import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSession, type Session } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { makeTracked, type Tracked } from "./tracked.ts";
import { sh } from "./repo.ts";

export const FROM = "2026-11-14T00:00:00.000Z";
export const LANDED_AT = "2026-11-14T10:00:00.000Z";

export interface Reviewing extends Tracked {
  operator: Session;
  data: Session;
  engine: Session;
  head: string;
  report: string;
}

export const requiring = (repo: Repo, required = true): Repo => ({ ...repo, config: { ...repo.config, reviews: { required, from: FROM } } });

export async function landedAt(repo: Repo, task: string, at: string | undefined): Promise<void> {
  await new Records(repo).update((ledger) => ({
    ledger: { ...ledger, milestones: ledger.milestones.map((one) => ({ ...one, tasks: one.tasks.map((t) => (t.id !== task ? t : { ...t, status: "landed" as const, commit: t.commit ?? "abc1234", ...(at === undefined ? {} : { landedAt: at }) })) })) },
    message: "landed",
  }));
}

export async function reviewing(required = true): Promise<Reviewing> {
  const tracked = await makeTracked();
  const repo = requiring(tracked.repo, required);
  await landedAt(repo, "done", LANDED_AT);
  const tree = tracked.trees["data"]!;
  await mkdir(join(tree, ".temp"), { recursive: true });
  const report = join(tree, ".temp", "review.md");
  await writeFile(report, "# review\n\nfine\n");
  return {
    ...tracked,
    repo,
    operator: await openSession(repo, { worktree: tracked.root, agent: "operator" }),
    data: await openSession(repo, { worktree: tree, agent: "claude" }),
    engine: await openSession(repo, { worktree: tracked.trees["engine"]!, agent: "kiro" }),
    head: await sh(tracked.root, ["rev-parse", "HEAD"]),
    report,
  };
}
