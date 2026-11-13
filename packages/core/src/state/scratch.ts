import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const SCRATCH_ROOT = ".temp";

export async function openScratch(worktree: string, track: string): Promise<string> {
  const folder = join(worktree, SCRATCH_ROOT, track);
  await mkdir(folder, { recursive: true });
  return folder;
}
