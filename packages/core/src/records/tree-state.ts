import { gitOut } from "../git/run.ts";
import { STATUS_WORDS, changesPathspec } from "../land/runner.ts";

export interface TreeState {
  head?: string;
  dirty?: boolean;
}

export async function treeState(worktree: string, track: string): Promise<TreeState> {
  const head = await gitOut(worktree, ["rev-parse", "HEAD"]);
  if (head === null) return {};
  const changes = await gitOut(worktree, [...STATUS_WORDS, ...changesPathspec(track)]);
  return changes === null ? { head } : { head, dirty: changes !== "" };
}
