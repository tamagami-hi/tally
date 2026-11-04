import { isAbsolute } from "node:path";
import { TallyError } from "../errors.ts";
import { currentBranch, porcelain } from "../git/refs.ts";
import { gitMust } from "../git/run.ts";
import type { Config, Track } from "../schema/config.ts";
import type { Repo } from "../store/records.ts";
import { isDocumentation } from "./paths.ts";

export interface LandOptions {
  track: string;
  files: readonly string[];
  messageFile?: string;
  verifiedCode?: string;
}

export function checkArguments(options: LandOptions, config: Config): void {
  for (const name of options.files) {
    if (isAbsolute(name) || name.split("/").includes("..")) throw new TallyError(`file must be relative to the worktree: ${name}`);
  }
  if ((options.messageFile !== undefined) !== (options.files.length > 0)) {
    throw new TallyError("a new commit needs both --message and explicit files");
  }
  if (options.verifiedCode !== undefined && options.files.some((name) => !isDocumentation(name, config))) {
    throw new TallyError("--verified-code is only for documentation/evidence on already checked code");
  }
}

export function checkTrackPaths(track: Track, files: readonly string[]): void {
  const { name, paths } = track;
  if (paths === undefined) return;
  const outside = files.filter((file) => !paths.some((path) => file === path || file.startsWith(`${path}/`)));
  if (outside.length > 0) throw new TallyError(`${name} lands only ${paths.join(", ")}: ${outside.join(", ")} is outside them`);
}

function pathOf(line: string): string {
  const path = line.slice(3);
  return path.includes(" -> ") ? (path.split(" -> ", 2)[1] ?? path) : path;
}

export async function checkCheckout(repo: Repo): Promise<void> {
  if ((await currentBranch(repo.root)) !== repo.config.mainBranch) throw new TallyError("operator checkout is not on main");
  const records = `${repo.config.records.dir}/`;
  const dirty = (await porcelain(repo.root)).filter((line) => !pathOf(line).startsWith(records));
  if (dirty.length > 0) throw new TallyError("operator checkout has changes; left untouched");
}

export async function checkWorktree(tree: string, branch: string, options: LandOptions, config: Config): Promise<void> {
  if ((await currentBranch(tree)) !== branch) throw new TallyError("worktree is not on its track branch");
  const staged = (await gitMust(tree, ["diff", "--cached", "--name-only"])).split("\n").filter((l) => l.length > 0);
  if (staged.some((name) => !options.files.includes(name))) throw new TallyError("unrelated staged files; left untouched");
  if (options.messageFile === undefined && (await porcelain(tree)).length > 0) {
    throw new TallyError("commit the task with --message and explicit files");
  }
  if (options.verifiedCode !== undefined) {
    const working = [
      ...(await gitMust(tree, ["diff", "HEAD", "--name-only"])).split("\n"),
      ...(await gitMust(tree, ["ls-files", "--others", "--exclude-standard"])).split("\n"),
    ].filter((l) => l.length > 0);
    if (working.some((name) => !isDocumentation(name, config))) {
      throw new TallyError("uncommitted code cannot reuse verification; task preserved");
    }
  }
}
