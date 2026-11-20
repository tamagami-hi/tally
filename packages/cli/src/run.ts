import { resolve } from "node:path";
import { Repos, TallyError, findRepoRoot, messageOf, openAt, readRepoList, tallyHome } from "@tally/core";
import { manyRepos } from "@tally/mcp";
import { splitRepo } from "./args.ts";
import { buildlogCommand } from "./commands/buildlog.ts";
import { checksCommand } from "./commands/checks.ts";
import { decisionCommand } from "./commands/decision.ts";
import { importCommand } from "./commands/import.ts";
import { initCommand } from "./commands/init.ts";
import { landCommand } from "./commands/land.ts";
import { ledgerCommand } from "./commands/ledger.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { plansCommand } from "./commands/plans.ts";
import { recordsCommand } from "./commands/records.ts";
import { repoCommand } from "./commands/repo.ts";
import { questionCommand } from "./commands/question.ts";
import { reportCommand } from "./commands/report.ts";
import { serveCommand, serveListCommand } from "./commands/serve.ts";
import { milestoneCommand } from "./commands/milestone.ts";
import { statusCommand } from "./commands/status.ts";
import { taskCommand } from "./commands/task.ts";
import { usageCommand } from "./commands/usage.ts";
import { versionCommand } from "./commands/version.ts";
import { viewsCommand } from "./commands/views.ts";
import { buildPlaceOf } from "./build-stamp.ts";
import type { IO } from "./io.ts";
import { remoteRun } from "./remote.ts";
import { serviceCli } from "./service-cli.ts";

export const USAGE = `tally: the tracking harness

  tally init   --name NAME [--baseline SHA] | --config FILE      make docs/records/ here
  tally import board PATH [--force]                              bring a board.json into the ledger
  tally import decisions|questions PATH --group G                bring a markdown table into the records
  tally import checks PATH | buildlog PATH --group G             bring code-checks.md or a build-log.md into the records
  tally import evidence DIR --milestone M --task T [--kind K] [--flat]   index a folder of run records (*.json + *.log), logs left in place
  tally import plans | tally plans list                          the plans under docs/*/next and docs/*/completed
  tally import documents                                         every Markdown document: its kind, title and purpose
  tally import answered FILE                                     rows answered before the record, as a JSON array
  tally records commit                                           commit every record waiting on disk (batch mode), as one commit
  tally report manifest DATE NAME --group G --narrative P [--bundle DIR] [--fingerprint F] [--evidence M[:T]]... [--decision ID]... [--question N]...
  tally checks get | render | fingerprint | set --file F         the code-check record; fingerprint exits 1 when stale
  tally buildlog render --group G | append --group G --milestone M --title T --date D --file BODY [--commit C]...
  tally question add --group G <question> <meanwhile> | answer <row> <decision> | edit <id> [--question T] [--meanwhile T] --why W | list
  tally decision list [--group G] | add|replace <id> --group G --text T --since S --status ST [--state STATE] [--section X] [--why W] [--by WHO] --operator
  tally decision setStatus <id> --group G --status ST [--state STATE] [--by WHO | --operator]   STATE: in force | built | partly built | decided, not built | other
  tally milestone add <id> --stage S --name N --track T --weight W [--waits X] [--group G]
  tally task   plan  <milestone> --track <track> <task>...       add tasks, the close last
  tally task   land  <milestone> <task> <commit> [--track T] [--also C]...
  tally task   wait  <milestone> <task> <what>
  tally task   unwait <milestone> <task>                         clear a task's wait
  tally task   remove <milestone> <task> --why REASON            remove a planned task that will not be done
  tally task   other <commit> <note>
  tally ledger check                                             commits on main the ledger misses
  tally status [--markdown | --json] [--no-color]
  tally views  claude [--check]                                  write the standing block between CLAUDE.md's tally:standing markers
  tally land   <track> [--message FILE] [--verified-code SHA] [--milestone M --task T] [files...]
  tally repo   add PATH [--name NAME] | remove NAME | default NAME | list   the repositories this tally serves
  tally serve  [--port 47560] [--host 127.0.0.1] [--web-dir DIR] [--workspace DIR]   the live board, the API and /mcp: every listed repository, or the one --repo names
  tally mcp                                                      the MCP server on stdio: every listed repository, or the one --repo names (or, with nothing listed, the one above the current folder)
  tally usage  [--json]                                          the tools by calls since counting began, what each costs in the tool list, and those never called
  tally version                                                  this source's version, its build's and, with TALLY_URL, the service's; exits 1 when the build is older
  tally <command> [<verb>] --help                                that command's lines of this list

  --repo PATH names the tracked repository; otherwise the one above the current folder.
  With TALLY_URL set to the service's address, every command but serve and mcp is carried out by the service.`;

const LOCAL = new Set(["serve", "mcp", "version", "usage"]);

const commandsIn = (line: string): string[] => [...line.matchAll(/\btally ([a-z]+)/g)].flatMap(([, word]) => word ?? []);

function usageOf(command: string): string {
  const lines = USAGE.split("\n").filter((line) => commandsIn(line).includes(command));
  if (lines.length === 0) throw new TallyError(`tally: unknown command '${command}'\n\n${USAGE}`, 2);
  return lines.join("\n");
}

function namesRepo(repoOption: string | undefined, io: IO): boolean {
  const fromEnv = io.env["TALLY_REPO"];
  return repoOption !== undefined || (fromEnv !== undefined && fromEnv !== "");
}

export async function servesTheList(repoOption: string | undefined, io: IO): Promise<boolean> {
  if (namesRepo(repoOption, io)) return false;
  return (await readRepoList(tallyHome(io.env))).repos.length > 0 || (await findRepoRoot(io.cwd)) === undefined;
}

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
    if (args.includes("--help") || args.includes("-h")) {
      io.out(usageOf(command));
      return 0;
    }
    const url = io.env["TALLY_URL"];
    if (url !== undefined && url !== "" && !LOCAL.has(command)) return await remoteRun(argv, io, url);
    if (command === "version") return await versionCommand(args, io, buildPlaceOf(import.meta.url));
    if (command === "init") return await initCommand(repoOption === undefined ? io.cwd : resolve(io.cwd, repoOption), args, io);
    if (command === "repo") return await repoCommand(args, io);
    const home = tallyHome(io.env);
    if (command === "usage") return await usageCommand(args, io, async () => ((await servesTheList(repoOption, io)) ? { home } : { stateDir: (await openAt(home, await locate(repoOption, io))).stateDir }));
    const everyRepo = (command === "mcp" || command === "serve") && (await servesTheList(repoOption, io));
    if (everyRepo && command === "mcp") return await mcpCommand(manyRepos(new Repos(home)), "every listed repository", io, { home });
    if (everyRepo) return await serveListCommand(args, io, serviceCli(run, io.env));
    const repo = await openAt(home, await locate(repoOption, io));
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
        return await mcpCommand(repo, repo.config.name, io, { stateDir: repo.stateDir });
      case "question":
        return await questionCommand(repo, args, io);
      case "checks":
        return await checksCommand(repo, args, io);
      case "decision":
        return await decisionCommand(repo, args, io);
      case "buildlog":
        return await buildlogCommand(repo, args, io);
      case "plans":
        return await plansCommand(repo, args, io);
      case "records":
        return await recordsCommand(repo, args, io);
      case "report":
        return await reportCommand(repo, args, io);
      case "views":
        return await viewsCommand(repo, args, io);
      default:
        throw new TallyError(`tally: unknown command '${command}'\n\n${USAGE}`, 2);
    }
  } catch (error: unknown) {
    io.err(messageOf(error));
    return error instanceof TallyError ? error.exit : 1;
  }
}
