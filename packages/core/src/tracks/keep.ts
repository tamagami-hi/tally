import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { safeName } from "../records/handoffs.ts";
import { SCRATCH_ROOT } from "../state/scratch.ts";
import type { Repo } from "../store/records.ts";
import { isPresent } from "./file.ts";

export const CLOSED_FOLDER = "closed";

const RUNNER_FOLDER = "tally";

async function listing(folder: string): Promise<string[]> {
  try {
    return await readdir(folder);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function holdsFiles(path: string): Promise<boolean> {
  if (!(await stat(path)).isDirectory()) return true;
  const inside = await readdir(path, { recursive: true, withFileTypes: true });
  return inside.some((entry) => !entry.isDirectory());
}

const copied = (from: string, to: string): Promise<void> => cp(from, to, { recursive: true, verbatimSymlinks: true });

export const discardKept = (folder: string): Promise<void> => rm(folder, { recursive: true, force: true });

const stampOf = (now: Date): string => `${now.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;

async function freeFolder(base: string, now: Date): Promise<string> {
  if (!(await isPresent(base))) return base;
  const stamped = `${base}-${stampOf(now)}`;
  for (let count = 1; ; count += 1) {
    const candidate = count === 1 ? stamped : `${stamped}-${count}`;
    if (!(await isPresent(candidate))) return candidate;
  }
}

async function freeName(folder: string, name: string): Promise<string> {
  for (let count = 1; ; count += 1) {
    const candidate = count === 1 ? name : `${name}-${count}`;
    if (!(await isPresent(join(folder, candidate)))) return join(folder, candidate);
  }
}

export async function keepScratch(repo: Repo, tree: string, track: string, now: Date): Promise<string | undefined> {
  const scratch = join(tree, SCRATCH_ROOT);
  const own = safeName(track);
  const groups = await Promise.all((await listing(scratch)).filter((name) => name !== RUNNER_FOLDER).map(async (name) => {
    const path = join(scratch, name);
    const isOwnFolder = name === own && (await stat(path)).isDirectory();
    return isOwnFolder ? (await listing(path)).map((child) => join(path, child)) : [path];
  }));
  const worth: string[] = [];
  for (const path of groups.flat()) if (await holdsFiles(path)) worth.push(path);
  if (worth.length === 0) return undefined;
  const folder = await freeFolder(join(repo.root, SCRATCH_ROOT, CLOSED_FOLDER, own), now);
  await mkdir(folder, { recursive: true });
  for (const path of worth) await copied(path, await freeName(folder, basename(path)));
  return folder;
}
