import { openSession, type Session } from "../../src/state/sessions.ts";
import { openRepo, type Repo } from "../../src/store/records.ts";
import type { Config } from "../../src/schema/config.ts";
import { makeTracked, type Tracked } from "./tracked.ts";

export interface Opening extends Tracked {
  operator: Session;
  data: Session;
  engine: Session;
  fresh: () => Promise<Repo>;
}

export async function opening(records: Partial<Config["records"]> = {}): Promise<Opening> {
  const tracked = await makeTracked(records);
  const { repo, root, trees } = tracked;
  const operator = await openSession(repo, { worktree: root, agent: "operator" });
  const data = await openSession(repo, { worktree: trees["data"] ?? "", agent: "claude" });
  const engine = await openSession(repo, { worktree: trees["engine"] ?? "", agent: "kiro" });
  return { ...tracked, operator, data, engine, fresh: () => openRepo(root) };
}
