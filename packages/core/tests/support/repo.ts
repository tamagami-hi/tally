import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { tmpDir } from "./tmp.ts";

const run = promisify(execFile);

export const IDENTITY = ["-c", "user.name=tester", "-c", "user.email=tester@example.com"];

export async function sh(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", [...IDENTITY, ...args], { cwd });
  return stdout.trim();
}

export interface Repo {
  root: string;
  commit: (file: string, content: string, message: string) => Promise<string>;
  head: () => Promise<string>;
}

export async function makeRepo(branch = "main"): Promise<Repo> {
  const root = await tmpDir("tally-repo-");
  await sh(root, ["init", "-q", "-b", branch]);
  await sh(root, ["config", "commit.gpgsign", "false"]);
  const repo: Repo = {
    root,
    commit: async (file, content, message) => {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), content);
      await sh(root, ["add", "--", file]);
      await sh(root, ["commit", "-q", "-m", message]);
      return sh(root, ["rev-parse", "HEAD"]);
    },
    head: () => sh(root, ["rev-parse", "HEAD"]),
  };
  await repo.commit("README.md", "# test\n", "initial");
  return repo;
}
