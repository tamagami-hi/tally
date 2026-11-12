import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { TallyError } from "../errors.ts";
import { git } from "../git/run.ts";

const GIT_FOLDER = ".git";
const NOT_A_REPOSITORY = /not a git repository/i;

export async function gitIn(folder: string, args: readonly string[]): Promise<string | null> {
  const result = await git(folder, args);
  if (result.code === 0) return result.stdout.replace(/\n$/, "");
  if (NOT_A_REPOSITORY.test(result.stderr)) return null;
  throw new TallyError(`git could not read ${folder}: ${result.stderr.trim()}`);
}

export async function realFolder(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TallyError(`${absolute} does not exist`);
    throw error;
  }
}

export async function rootOfWorktree(path: string): Promise<string> {
  const folder = await realFolder(path);
  const common = await gitIn(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common === null) throw new TallyError(`${folder} is not inside a git repository`);
  if (basename(common) !== GIT_FOLDER) {
    throw new TallyError(`${folder} has no checkout of its own (a bare repository, or one whose git folder is kept elsewhere); tally needs the repository's own checkout`);
  }
  return realpath(dirname(common));
}
