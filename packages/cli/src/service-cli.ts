import type { CliAnswer, CliRunner } from "@tally/server";
import type { IO } from "./io.ts";

const COLUMNS = 120;

export type Run = (argv: readonly string[], io: IO) => Promise<number>;

export function serviceCli(run: Run, env: NodeJS.ProcessEnv): CliRunner {
  const { TALLY_URL: _url, ...own } = env;
  return async (argv, cwd): Promise<CliAnswer> => {
    const out: string[] = [];
    const err: string[] = [];
    const exit = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line), cwd, env: own, columns: COLUMNS, isTTY: false });
    return { exit, out, err };
  };
}
