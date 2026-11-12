import { resolve } from "node:path";
import { TallyError, addRepo, readRepoList, removeRepo, setDefaultRepo, tallyHome } from "@tally/core";
import { need, parse, text, type Parsed } from "../args.ts";
import type { IO } from "../io.ts";

function atMost(parsed: Parsed, count: number): Parsed {
  const extra = parsed.positionals[count];
  if (extra !== undefined) throw new TallyError(`tally repo: unexpected argument '${extra}'`, 2);
  return parsed;
}

export async function repoCommand(argv: readonly string[], io: IO): Promise<number> {
  const [verb, ...rest] = argv;
  const home = tallyHome(io.env);
  switch (verb) {
    case "add": {
      const parsed = atMost(parse(rest, { name: { type: "string" } }), 1);
      const name = text(parsed, "name");
      const entry = await addRepo(home, { root: resolve(io.cwd, need(parsed, 0, "the repository's folder")), ...(name === undefined ? {} : { name }) });
      io.out(`added ${entry.name}: ${entry.root}`);
      return 0;
    }
    case "remove": {
      const entry = await removeRepo(home, need(atMost(parse(rest, {}), 1), 0, "the repository's name"));
      io.out(`removed ${entry.name}; its records and its state are left as they are`);
      return 0;
    }
    case "default": {
      const list = await setDefaultRepo(home, need(atMost(parse(rest, {}), 1), 0, "the repository's name"));
      io.out(`the default repository is ${list.default ?? ""}`);
      return 0;
    }
    case "list": {
      atMost(parse(rest, {}), 0);
      const list = await readRepoList(home);
      if (list.repos.length === 0) io.out("no repository is listed");
      for (const repo of list.repos) io.out(`${repo.name}  ${repo.root}${repo.name === list.default ? "  (default)" : ""}`);
      return 0;
    }
    default:
      throw new TallyError(`tally repo: unknown verb '${verb ?? ""}'; use add, remove, default or list`, 2);
  }
}
