import type { CliAnswer, CliLine, CliRunner } from "@tally/server";
import type { IO } from "./io.ts";

const COLUMNS = 120;

export type Run = (argv: readonly string[], io: IO) => Promise<number>;

export function serviceCli(run: Run, env: NodeJS.ProcessEnv): CliRunner {
  const { TALLY_URL: _url, ...own } = env;
  return async (argv, cwd): Promise<CliAnswer> => {
    const lines: CliLine[] = [];
    const exit = await run(argv, { out: (text) => lines.push({ to: "out", text }), err: (text) => lines.push({ to: "err", text }), cwd, env: own, columns: COLUMNS, isTTY: false });
    return { exit, lines };
  };
}
