import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openSession, type Session } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { sh } from "./repo.ts";
import { makeTracked } from "./tracked.ts";

export const AT = new Date("2026-11-21T10:00:00.000Z");

export interface Releasing {
  repo: Repo;
  root: string;
  trees: Record<string, string>;
  operator: Session;
  data: Session;
  onMain: (file: string, subject: string) => Promise<string>;
  landTask: (task: string, commit: string) => Promise<void>;
}

export async function releasing(): Promise<Releasing> {
  const { repo, root, trees } = await makeTracked();
  const operator = await openSession(repo, { worktree: root, agent: "operator" });
  const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
  const onMain = async (file: string, subject: string): Promise<string> => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), `${subject}\n`);
    await sh(root, ["add", "--", file]);
    await sh(root, ["commit", "-q", "-m", subject]);
    return sh(root, ["rev-parse", "--short=7", "HEAD"]);
  };
  const landTask = async (task: string, commit: string): Promise<void> => {
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => ({ ...milestone, tasks: milestone.tasks.map(({ waits: _waits, ...one }) => (one.id === task ? { ...one, status: "landed" as const, commit } : one)) })) }, message: "landed" }));
  };
  return { repo, root, trees, operator, data, onMain, landTask };
}
