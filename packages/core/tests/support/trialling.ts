import { access } from "node:fs/promises";
import { join } from "node:path";
import { openSession, type Session } from "../../src/state/sessions.ts";
import type { Repo } from "../../src/store/records.ts";
import { commitOn } from "./landing.ts";
import { sh } from "./repo.ts";
import { makeTracked } from "./tracked.ts";

export const AT = new Date("2026-11-21T10:00:00.000Z");

export interface Trialling {
  repo: Repo;
  root: string;
  trees: Record<string, string>;
  operator: Session;
  data: Session;
  folder: (name: string) => string;
  hasBranch: (name: string) => Promise<boolean>;
  hasFolder: (name: string) => Promise<boolean>;
  subjects: (ref: string, count: number) => Promise<string[]>;
}

export async function trialling(): Promise<Trialling> {
  const { repo, root, trees } = await makeTracked();
  const operator = await openSession(repo, { worktree: root, agent: "operator" });
  const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
  await commitOn(trees["data"]!, "src/data-one.rs", "feat: data one");
  await commitOn(trees["data"]!, "src/data-two.rs", "feat: data two");
  await commitOn(trees["engine"]!, "src/engine.rs", "feat: engine");
  const folder = (name: string): string => join(root, ".temp/tally/trials", name);
  const hasBranch = async (name: string): Promise<boolean> => (await sh(root, ["branch", "--list", `trial/${name}`])) !== "";
  const hasFolder = (name: string): Promise<boolean> => access(folder(name)).then(() => true, () => false);
  const subjects = async (ref: string, count: number): Promise<string[]> => (await sh(root, ["log", `-${count}`, "--format=%s", "--reverse", ref])).split("\n");
  return { repo, root, trees, operator, data, folder, hasBranch, hasFolder, subjects };
}
