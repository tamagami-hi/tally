import { TallyError, readUsage, usagePathOf } from "@tally/core";
import { listedEntries, usageRanking, type Ranked, type Ranking } from "@tally/mcp";
import type { IO } from "../io.ts";

const ASKING_MS = 5_000;
const COLUMNS = ["calls", "refused", "cut", "invalid", "days", "chars"] as const;
const NAME_WIDTH = 22;
const NUMBER_WIDTH = 8;

export type UsagePlace = { home: string } | { stateDir: string };

async function fromService(url: string): Promise<Ranking> {
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/api/usage`, { signal: AbortSignal.timeout(ASKING_MS) });
    if (!response.ok) throw new TallyError(`the service at ${url} answered ${response.status} for /api/usage; it may be older than 0.7.0`);
    return (await response.json()) as Ranking;
  } catch (error: unknown) {
    if (error instanceof TallyError) throw error;
    throw new TallyError(`tally is not reachable at ${url}; start the service, or unset TALLY_URL to read the count on this machine`);
  }
}

const row = (tool: Ranked): string => `${[tool.name.padEnd(NAME_WIDTH), ...COLUMNS.map((key) => String(tool[key]).padStart(NUMBER_WIDTH))].join(" ")}${tool.listed ? "" : " not listed"}`;

function printed(ranking: Ranking, io: IO): void {
  const versions = ranking.versions.map((one) => `${one.version} from ${one.since}`).join(", ");
  io.out(`counted since ${ranking.since}${versions === "" ? "" : `; served: ${versions}`}`);
  io.out(["tool".padEnd(NAME_WIDTH), ...COLUMNS.map((key) => key.padStart(NUMBER_WIDTH))].join(" "));
  for (const tool of ranking.tools) io.out(row(tool));
  const never = ranking.never;
  io.out(`never called: ${never.tools.length} tools, ${never.chars} characters of the list${never.tools.length === 0 ? "" : `: ${never.tools.join(", ")}`}`);
}

export async function usageCommand(args: readonly string[], io: IO, place: () => Promise<UsagePlace>): Promise<number> {
  const asJson = args.includes("--json");
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) throw new TallyError(`tally usage takes only --json, not ${unknown.join(" ")}`, 2);
  const url = io.env["TALLY_URL"];
  const ranking = url !== undefined && url !== "" ? await fromService(url) : usageRanking(await readUsage(usagePathOf(await place())), listedEntries("service"));
  if (asJson) io.out(JSON.stringify(ranking, null, 2));
  else printed(ranking, io);
  return 0;
}
