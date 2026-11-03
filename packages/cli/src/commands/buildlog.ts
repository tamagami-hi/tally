import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TallyError, appendBuildlog, readBuildlog, renderBuildlog, type Repo } from "@tally/core";
import { list, parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export async function buildlogCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "render": {
      const parsed = parse(rest, { group: { type: "string" } });
      const group = text(parsed, "group");
      if (group === undefined) throw new TallyError("buildlog render needs --group", 2);
      io.out(renderBuildlog(await readBuildlog(repo), group).replace(/\n$/, ""));
      return 0;
    }
    case "append": {
      const parsed = parse(rest, { group: { type: "string" }, milestone: { type: "string" }, title: { type: "string" }, date: { type: "string" }, file: { type: "string" }, commit: { type: "string", multiple: true } });
      const group = text(parsed, "group");
      const milestone = text(parsed, "milestone");
      const title = text(parsed, "title");
      const date = text(parsed, "date");
      const file = text(parsed, "file");
      if (group === undefined || milestone === undefined || title === undefined || date === undefined || file === undefined) {
        throw new TallyError("buildlog append needs --group, --milestone, --title, --date and --file <body.md>", 2);
      }
      const markdown = await readFile(resolve(io.cwd, file), "utf8");
      const { entry, commit } = await appendBuildlog(repo, { group, milestone, title, date, markdown, commits: list(parsed, "commit") });
      io.out(`${group} build log: ${entry.milestone}. ${entry.title}, ${entry.date}`);
      if (commit !== null) io.out(`records: ${commit}`);
      return 0;
    }
    default:
      throw new TallyError(`tally buildlog: unknown verb '${verb ?? ""}'; use render or append`, 2);
  }
}
