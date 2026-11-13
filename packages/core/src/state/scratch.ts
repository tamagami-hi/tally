import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { safeName } from "../records/handoffs.ts";

export const SCRATCH_ROOT = ".temp";

export async function openScratch(worktree: string, track: string): Promise<string> {
  const folder = join(worktree, SCRATCH_ROOT, safeName(track));
  await mkdir(folder, { recursive: true });
  return folder;
}
