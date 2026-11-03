import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { TallyError } from "@tally/core";

export interface Parsed {
  positionals: string[];
  values: Record<string, string | boolean | string[] | undefined>;
}

export function parse(argv: readonly string[], options: ParseArgsOptionsConfig): Parsed {
  try {
    const parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
    return { positionals: parsed.positionals, values: parsed.values as Parsed["values"] };
  } catch (error: unknown) {
    throw new TallyError(error instanceof Error ? error.message : String(error), 2);
  }
}

export function text(parsed: Parsed, name: string): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

export function list(parsed: Parsed, name: string): string[] {
  const value = parsed.values[name];
  return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
}

export function flag(parsed: Parsed, name: string): boolean {
  return parsed.values[name] === true;
}

export function need(parsed: Parsed, index: number, what: string): string {
  const value = parsed.positionals[index];
  if (value === undefined) throw new TallyError(`missing ${what}`, 2);
  return value;
}

export function splitRepo(argv: readonly string[]): { repo: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let repo: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") {
      repo = argv[i + 1];
      i += 1;
    } else if (arg?.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
    } else if (arg !== undefined) {
      rest.push(arg);
    }
  }
  return { repo, rest };
}
