import { resolve } from "node:path";
import { TallyError, findRepoRoot, messageOf, openRepo } from "@tally/core";
import { splitRepo } from "./args.ts";
import { importCommand } from "./commands/import.ts";
import { initCommand } from "./commands/init.ts";
import { landCommand } from "./commands/land.ts";
import { ledgerCommand } from "./commands/ledger.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { questionCommand } from "./commands/question.ts";
import { serveCommand } from "./commands/serve.ts";
import { milestoneCommand } from "./commands/milestone.ts";
import { statusCommand } from "./commands/status.ts";
import { taskCommand } from "./commands/task.ts";
import type { IO } from "./io.ts";

export const USAGE = `tally: the tracking harness

  tally init   --name NAME [--baseline SHA] | --config FILE      make docs/records/ here
  tally import board PATH [--force]                              bring a board.json into the ledger
  tally import decisions|questions PATH --group G                bring a markdown table into the records
  tally question add --group G <question> <meanwhile> | answer <row> <decision> | list
  tally milestone add <id> --stage S --name N --track T --weight W [--waits X] [--group G]
  tally task   plan  <milestone> --track <track> <task>...       add tasks, the close last
  tally task   land  <milestone> <task> <commit> [--track T] [--also C]...
  tally task   wait  <milestone> <task> <what>
  tally task   other <commit> <note>
  tally ledger check                                             commits on main the ledger misses
  tally status [--markdown | --json] [--no-color]
  tally land   <track> [--message FILE] [--verified-code SHA] [files...]
  tally serve  [--port 47560] [--host 127.0.0.1] [--web-dir DIR]   the live board, the API and /mcp
  tally mcp                                                      the MCP server on stdio

  --repo PATH names the tracked repository; otherwise the one above the current folder.`;

async function locate(repoOption: string | undefined, io: IO): Promise<string> {
  if (repoOption !== undefined) return resolve(io.cwd, repoOption);
  const fromEnv = io.env["TALLY_REPO"];
  if (fromEnv !== undefined && fromEnv !== "") return resolve(io.cwd, fromEnv);
  const found = await findRepoRoot(io.cwd);
  if (found === undefined) throw new TallyError(`no docs/records/config.json above ${io.cwd}; pass --repo`, 2);
  return found;
}

export async function run(argv: readonly string[], io: IO): Promise<number> {
  const { repo: repoOption, rest } = splitRepo(argv);
  const [command, ...args] = rest;
  try {
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
      io.out(USAGE);
      return command === undefined ? 2 : 0;
    }
    if (command === "init") return await initCommand(repoOption === undefined ? io.cwd : resolve(io.cwd, repoOption), args, io);
    const repo = await openRepo(await locate(repoOption, io));
    switch (command) {
      case "task":
        return await taskCommand(repo, args, io);
      case "ledger":
        return await ledgerCommand(repo, args, io);
      case "milestone":
        return await milestoneCommand(repo, args, io);
      case "status":
        return await statusCommand(repo, args, io);
      case "land":
        return await landCommand(repo, args, io);
      case "import":
        return await importCommand(repo, args, io);
      case "serve":
        return await serveCommand(repo, args, io);
      case "mcp":
        return await mcpCommand(repo, io);
      case "question":
        return await questionCommand(repo, args, io);
      default:
        throw new TallyError(`tally: unknown command '${command}'\n\n${USAGE}`, 2);
    }
  } catch (error: unknown) {
    io.err(messageOf(error));
    return error instanceof TallyError ? error.exit : 1;
  }
}
