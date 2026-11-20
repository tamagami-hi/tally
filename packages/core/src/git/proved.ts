import { gitOut } from "./run.ts";

const SIDE = /^[^\s-]\S*$/;

export async function provedCommit(root: string, given: string): Promise<string | null> {
  if (!SIDE.test(given)) return null;
  return gitOut(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${given}^{commit}`]);
}
