import { lstat, mkdir, realpath, stat, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Stats } from "node:fs";
import { TallyError } from "../errors.ts";
import { gitMust, gitOut } from "../git/run.ts";
import { safeName } from "../records/handoffs.ts";

export function landingCheckoutPath(tree: string, track: string): string {
  return join(tree, ".temp", safeName(track), "landing");
}

async function isCheckoutOfItsOwn(path: string): Promise<boolean> {
  const top = await gitOut(path, ["rev-parse", "--show-toplevel"]);
  return top !== null && top === (await realpath(path));
}

export async function openLandingCheckout(tree: string, track: string): Promise<string> {
  const path = landingCheckoutPath(tree, track);
  if (await isCheckoutOfItsOwn(path)) return path;
  await mkdir(dirname(path), { recursive: true });
  await gitMust(tree, ["worktree", "add", "--quiet", "--force", "--detach", path, "HEAD"]);
  return path;
}

async function statOrNull(read: Promise<Stats>): Promise<Stats | null> {
  try {
    return await read;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function linkFromWorktree(tree: string, checkout: string, path: string): Promise<void> {
  const source = resolve(tree, path);
  const target = resolve(checkout, path);
  const present = await statOrNull(lstat(target));
  if (present !== null && !present.isSymbolicLink()) throw new TallyError(`the landing cannot link ${path}: the checkout has its own, and the tests must see that`);
  if ((await statOrNull(stat(source))) === null) throw new TallyError(`the landing cannot link ${path}: the worktree has none`);
  if (present !== null) await unlink(target);
  await mkdir(dirname(target), { recursive: true });
  await symlink(source, target);
}

export async function moveLandingCheckout(checkout: string, commit: string, tree: string, link: readonly string[]): Promise<void> {
  await gitMust(checkout, ["checkout", "--quiet", "--detach", "--force", commit]);
  await gitMust(checkout, ["clean", "--quiet", "-fd"]);
  for (const path of link) await linkFromWorktree(tree, checkout, path);
}
