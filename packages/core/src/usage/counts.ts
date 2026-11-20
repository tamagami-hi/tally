import { rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError, messageOf } from "../errors.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import type { Exact } from "../schema/kept.ts";

export const USAGE_FILE = "usage.json";
export const FLUSH_MS = 30_000;

const DAY_LENGTH = 10;
const SCOPES = ["operator", "track", "none"] as const;

export type Outcome = "answered" | "refused" | "cut" | "invalid";
export type Scope = (typeof SCOPES)[number];

export interface Counted {
  tool: string;
  outcome: Outcome;
  by: Scope;
  via?: string;
  repo?: string;
}

const tally = z.record(z.string(), z.number().int().nonnegative());

const toolCountSchema = z.looseObject({
  calls: z.number().int().nonnegative(),
  refused: z.number().int().nonnegative(),
  cut: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  first: z.string(),
  last: z.string(),
  days: z.number().int().nonnegative(),
  lastDay: z.string(),
  by: tally,
  via: tally,
  repos: tally,
});

export const usageFileSchema = z.looseObject({
  schema: z.literal(1),
  since: z.string(),
  versions: z.array(z.looseObject({ version: z.string(), since: z.string() })),
  tools: z.record(z.string(), toolCountSchema),
});

export type ToolCount = Exact<z.infer<typeof toolCountSchema>>;
export type UsageFile = Exact<z.infer<typeof usageFileSchema>>;

export const usagePathOf = (where: { home: string } | { stateDir: string }): string => join("home" in where ? where.home : where.stateDir, USAGE_FILE);

const emptyFile = (now: Date): UsageFile => ({ schema: 1, since: now.toISOString(), versions: [], tools: {} });

const oneLine = (text: string): string => text.replaceAll(/\s*\n\s*/g, "; ");

async function setAside(path: string, now: Date, error: unknown): Promise<string> {
  const reason = oneLine(messageOf(error));
  if (!(error instanceof TallyError)) return `tally could not read ${path} (${reason}); the count starts empty`;
  const aside = `${path}.${now.toISOString().replaceAll(":", "-")}.unreadable`;
  try {
    await rename(path, aside);
    return `tally could not read ${path} (${reason}); it was moved to ${aside}, and the count starts empty`;
  } catch (moving: unknown) {
    return `tally could not read ${path} (${reason}) nor move it aside (${oneLine(messageOf(moving))}); the count starts empty`;
  }
}

export async function readUsage(path: string, now = new Date()): Promise<UsageFile> {
  try {
    return await readJson(path, usageFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return emptyFile(now);
    process.stderr.write(`${await setAside(path, now, error)}\n`);
    return emptyFile(now);
  }
}

const added = (counts: Readonly<Record<string, number>>, key: string | undefined): Record<string, number> => (key === undefined ? { ...counts } : { ...counts, [key]: (counts[key] ?? 0) + 1 });

const emptyCount = (at: string): ToolCount => ({ calls: 0, refused: 0, cut: 0, invalid: 0, first: at, last: at, days: 0, lastDay: "", by: Object.fromEntries(SCOPES.map((scope) => [scope, 0])), via: {}, repos: {} });

export function countedIn(count: ToolCount | undefined, called: Counted, now: Date): ToolCount {
  const at = now.toISOString();
  const day = at.slice(0, DAY_LENGTH);
  const held = count ?? emptyCount(at);
  const dated = { ...held, last: at, days: held.lastDay === day ? held.days : held.days + 1, lastDay: day };
  if (called.outcome === "invalid") return { ...dated, invalid: held.invalid + 1 };
  return {
    ...dated,
    calls: held.calls + 1,
    refused: held.refused + (called.outcome === "refused" ? 1 : 0),
    cut: held.cut + (called.outcome === "cut" ? 1 : 0),
    by: added(held.by, called.by),
    via: added(held.via, called.via),
    repos: added(held.repos, called.repo),
  };
}

const servedFrom = (file: UsageFile, version: string, now: Date): UsageFile =>
  file.versions.at(-1)?.version === version ? file : { ...file, versions: [...file.versions, { version, since: now.toISOString() }] };

export class Usage {
  readonly path: string;
  private file: UsageFile;
  private dirty = false;
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();

  private constructor(path: string, file: UsageFile) {
    this.path = path;
    this.file = file;
  }

  static async open(path: string, version: string, now = new Date()): Promise<Usage> {
    return new Usage(path, servedFrom(await readUsage(path, now), version, now));
  }

  count(called: Counted, now = new Date()): void {
    this.file = { ...this.file, tools: { ...this.file.tools, [called.tool]: countedIn(this.file.tools[called.tool], called, now) } };
    this.dirty = true;
  }

  snapshot(): UsageFile {
    return this.file;
  }

  flush(): Promise<void> {
    this.writing = this.writing.catch(() => undefined).then(() => this.write());
    return this.writing;
  }

  private async write(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await writeJsonAtomic(this.path, usageFileSchema.parse(this.file));
  }

  start(intervalMs = FLUSH_MS): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.flush().catch((error: unknown) => process.stderr.write(`tally could not write ${this.path}: ${String(error)}\n`)), intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }
}
