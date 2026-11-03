import { join } from "node:path";
import { initRecords, openRepo, type Config, type Repo } from "../../src/index.ts";
import { Records } from "../../src/store/records.ts";
import { makeRepo, sh } from "./repo.ts";

export const trackedConfig: Config = {
  schema: 1,
  name: "Test",
  mainBranch: "main",
  docsDir: "docs",
  tracks: [
    { name: "data", worktree: ".temp/worktrees/data", branch: "track/data" },
    { name: "engine", worktree: ".temp/worktrees/engine", branch: "track/engine" },
  ],
  stages: [{ id: "B", name: "widen", weight: 1 }],
  commands: { test: ["true"], env: {}, unset: [] },
  fingerprint: { paths: ["src"], exclude: ["*.md"] },
  identity: { name: "operator", email: "operator@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit: false },
  locks: ["landing", "evidence"],
};

export interface Tracked {
  repo: Repo;
  root: string;
  trees: Record<string, string>;
}

export async function makeTracked(): Promise<Tracked> {
  const git = await makeRepo();
  await git.commit(".gitignore", ".temp/\n", "chore: ignore");
  await git.commit("RULES.md", "# Rules\n\n1. Keep it simple.\n", "docs: rules");
  await initRecords(git.root, trackedConfig, (await git.head()).slice(0, 7));
  await sh(git.root, ["add", "-A"]);
  await sh(git.root, ["commit", "-q", "-m", "records: init"]);
  const trees: Record<string, string> = {};
  for (const name of ["data", "engine"]) {
    trees[name] = join(git.root, ".temp", "worktrees", name);
    await sh(git.root, ["worktree", "add", "-q", trees[name], "-b", `track/${name}`, "main"]);
  }
  const repo = await openRepo(git.root);
  await new Records(repo).writeLedger({
    schema: 1,
    baseline: (await git.head()).slice(0, 7),
    other: [],
    milestones: [{ id: "B2", stage: "B", name: "store", track: "data+engine", weight: 1, tasks: [
      { id: "4 manifest", track: "data", status: "planned", also: [] },
      { id: "5 transcoder", track: "data", status: "planned", also: [] },
      { id: "T9 store", track: "engine", status: "planned", also: [], waits: "B2" },
      { id: "done", track: "data", status: "landed", commit: "abc1234", also: [] },
    ] }],
  });
  return { repo, root: git.root, trees };
}
