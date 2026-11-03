import { Paint, Records, collect, renderMarkdown, renderTerminal, type Repo } from "@tally/core";
import { flag, parse } from "../args.ts";
import type { IO } from "../io.ts";

export async function statusCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, { markdown: { type: "boolean" }, json: { type: "boolean" }, "no-color": { type: "boolean" } });
  const status = await collect(repo, await new Records(repo).readLedger());
  if (flag(parsed, "json")) io.out(JSON.stringify(status, null, 2));
  else if (flag(parsed, "markdown")) io.out(renderMarkdown(status));
  else {
    const colour = io.isTTY && !flag(parsed, "no-color") && io.env["NO_COLOR"] === undefined;
    io.out(renderTerminal(status, new Paint(colour), io.columns));
  }
  return status.problems.length > 0 ? 1 : 0;
}
