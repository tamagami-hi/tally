import { TallyError, writeClaudeView, type Repo } from "@tally/core";
import { flag, parse } from "../args.ts";
import type { IO } from "../io.ts";

export async function viewsCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [view, ...rest] = argv;
  if (view !== "claude") throw new TallyError(`tally views: unknown view '${view ?? ""}'; use claude`, 2);
  const parsed = parse(rest, { check: { type: "boolean" } });
  const check = flag(parsed, "check");
  const { path, changed } = await writeClaudeView(repo, { check });
  if (!changed) io.out(`${path}: the standing block is current`);
  else if (check) io.out(`${path}: the standing block is stale; run tally views claude`);
  else io.out(`${path}: the standing block written`);
  return check && changed ? 1 : 0;
}
