import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { landingCheckoutPath } from "../../src/land/checkout.ts";
import { landingLog, loggedTests } from "../../src/land/run-tests.ts";
import type { LandDeps } from "../../src/land/run.ts";
import type { Config, Landing } from "../../src/schema/config.ts";
import { initRecords, openRepo, type Repo } from "../../src/store/records.ts";
import { makeRepo, sh } from "./repo.ts";

const SEEN = "git log -1 --format='%H %s' >> \"$RUNS\"; ";

const config = (root: string, script: string, landing: Landing | null): Config => ({
  schema: 1,
  name: "Test",
  mainBranch: "main",
  docsDir: "docs",
  tracks: [{ name: "data", worktree: ".temp/worktrees/data", branch: "track/data" }],
  stages: [{ id: "A", name: "a", weight: 1 }],
  commands: {
    test: ["sh", "-c", `${SEEN}${script}`],
    env: { RUNS: join(root, ".temp", "runs.txt") },
    unset: ["CARGO_TARGET_DIR"],
    tmpdir: ".temp/{track}/tmp",
    ...(landing === null ? {} : { landing }),
  },
  fingerprint: { paths: ["src"], exclude: ["*.md"] },
  identity: { name: "operator", email: "operator@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit: false },
  locks: ["landing"],
});

export interface LandingFixture {
  repo: Repo;
  root: string;
  tree: string;
  checkout: string;
  message: string;
  log: string;
  deps: LandDeps;
  head: () => Promise<string>;
  main: () => Promise<string>;
  runs: () => Promise<string[]>;
}

export async function edit(tree: string, file: string, content = "x\n"): Promise<void> {
  await mkdir(join(tree, file, ".."), { recursive: true });
  await writeFile(join(tree, file), content);
}

export async function commitOn(tree: string, file: string, subject: string, content = "x\n"): Promise<string> {
  await edit(tree, file, content);
  await sh(tree, ["add", "--", file]);
  await sh(tree, ["commit", "-q", "-m", subject]);
  return sh(tree, ["rev-parse", "HEAD"]);
}

export async function landingFixture(script: string, landing: Landing | null = {}): Promise<LandingFixture> {
  const git = await makeRepo();
  await git.commit(".gitignore", ".temp/\ndeps/\n", "chore: ignore scratch");
  await git.commit("src/lib.rs", "fn a() {}\n", "feat: a");
  await initRecords(git.root, config(git.root, script, landing), (await git.head()).slice(0, 7));
  await sh(git.root, ["add", "-A"]);
  await sh(git.root, ["commit", "-q", "-m", "records: init"]);
  const tree = join(git.root, ".temp", "worktrees", "data");
  await sh(git.root, ["worktree", "add", "-q", tree, "-b", "track/data", "main"]);
  const message = join(git.root, ".temp", "message.txt");
  await writeFile(message, "feat(data): the task\n\nwhy it is so\n");
  const log = landingLog(tree, "data");
  const runs = join(git.root, ".temp", "runs.txt");
  return {
    repo: await openRepo(git.root),
    root: git.root,
    tree,
    checkout: landingCheckoutPath(tree, "data"),
    message,
    log,
    deps: { runTests: loggedTests(log), log: () => undefined },
    head: () => sh(tree, ["rev-parse", "HEAD"]),
    main: () => sh(git.root, ["rev-parse", "main"]),
    runs: async () => (await readFile(runs, "utf8").catch(() => "")).split("\n").filter((line) => line !== ""),
  };
}
