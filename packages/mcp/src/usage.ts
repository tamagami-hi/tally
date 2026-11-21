import type { Tool } from "@modelcontextprotocol/server";
import type { Known, ToolCount, UsageFile } from "@tally/core";

export type Ranked = Omit<Known<ToolCount>, "lastDay"> & { name: string; listed: boolean; chars: number };

export interface Ranking {
  since: string;
  versions: { version: string; since: string }[];
  tools: Ranked[];
  never: { tools: string[]; chars: number };
}

const charsOf = (entry: Tool): number => JSON.stringify(entry).length;

const byCalls = (a: Ranked, b: Ranked): number => b.calls - a.calls || b.invalid - a.invalid || a.name.localeCompare(b.name);

export function usageRanking(file: UsageFile, entries: readonly Tool[]): Ranking {
  const listed = new Map(entries.map((entry) => [entry.name, charsOf(entry)]));
  const tools = Object.entries(file.tools)
    .filter(([, count]) => count.calls + count.invalid > 0)
    .map(([name, { lastDay: _day, ...count }]): Ranked => ({ name, listed: listed.has(name), chars: listed.get(name) ?? 0, ...count }))
    .sort(byCalls);
  const called = new Set(tools.map((tool) => tool.name));
  const never = entries.map((entry) => entry.name).filter((name) => !called.has(name)).sort();
  return {
    since: file.since,
    versions: file.versions.map(({ version, since }) => ({ version, since })),
    tools,
    never: { tools: never, chars: never.reduce((sum, name) => sum + (listed.get(name) ?? 0), 0) },
  };
}
