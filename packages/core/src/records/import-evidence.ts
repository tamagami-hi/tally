import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import { writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { Records, type Repo } from "../store/records.ts";
import { commitRecords } from "./commit.ts";
import { evidencePath, readEvidence, type EvidenceKind, type RunRecord } from "./evidence.ts";
import { summarize } from "./run.ts";

const runShape = z
  .object({
    command: z.array(z.string()).min(1),
    cwd: z.string().min(1),
    exit: z.number().int(),
    seconds: z.number().nonnegative().optional(),
    elapsed_seconds: z.number().nonnegative().optional(),
    started: z.union([z.number(), z.string()]).optional(),
    head: z.string().optional(),
    head_before: z.string().optional(),
    head_after: z.string().optional(),
  })
  .loose();

const KINDS: [RegExp, EvidenceKind][] = [[/clippy/, "clippy"], [/fmt|format/, "fmt"], [/land/, "land"], [/coverage|llvm-cov/, "coverage"], [/sweep/, "sweep"], [/red|failing/, "red"], [/green|passing/, "green"]];
const SKIPPED_FOLDERS = new Set(["tmp", "node_modules", "target"]);

export function kindOf(name: string): EvidenceKind {
  const low = basename(name).toLowerCase();
  return KINDS.find(([pattern]) => pattern.test(low))?.[1] ?? "other";
}

export async function walkJson(dir: string, flat = false): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new TallyError(`${dir} cannot be read`);
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !flat && !SKIPPED_FOLDERS.has(entry.name) && !entry.name.startsWith(".")) found.push(...(await walkJson(path)));
    else if (entry.isFile() && entry.name.endsWith(".json")) found.push(path);
  }
  return found.sort();
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

async function hashedLog(jsonPath: string): Promise<{ log: RunRecord["log"]; text: string }> {
  const logPath = `${jsonPath.slice(0, -".json".length)}.log`;
  try {
    const bytes = await readFile(logPath);
    return { log: { path: logPath, sha256: sha256(bytes), bytes: bytes.length }, text: bytes.toString("utf8") };
  } catch {
    return { log: undefined, text: "" };
  }
}

export interface ImportOptions {
  milestone: string;
  task: string;
  kind?: EvidenceKind;
  flat?: boolean;
}

async function toRecord(repo: Repo, jsonPath: string, options: ImportOptions, track: string): Promise<RunRecord | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    return null;
  }
  const shaped = runShape.safeParse(parsed);
  if (!shaped.success) return null;
  const run = shaped.data;
  const seconds = run.seconds ?? run.elapsed_seconds;
  if (seconds === undefined) return null;
  const rel = relative(repo.root, jsonPath);
  const fromMtime = run.started === undefined;
  const started = typeof run.started === "number" ? new Date(run.started * 1000).toISOString() : typeof run.started === "string" ? run.started : (await stat(jsonPath)).mtime.toISOString();
  const { log, text } = await hashedLog(jsonPath);
  const heads = Object.fromEntries(Object.entries({ head: run.head, head_before: run.head_before, head_after: run.head_after }).filter(([, value]) => value !== undefined)) as Record<string, string>;
  const summary = { ...(summarize(text) ?? {}), ...heads };
  return {
    id: sha256(Buffer.from(`${options.milestone}\u0000${options.task}\u0000${rel}`)).slice(0, 32),
    task: options.task,
    track,
    agent: "import",
    kind: options.kind ?? kindOf(jsonPath),
    command: run.command,
    cwd: run.cwd,
    started,
    seconds,
    exit: run.exit,
    ...(log === undefined ? {} : { log }),
    ...(Object.keys(summary).length === 0 ? {} : { summary }),
    note: `indexed from ${rel}${fromMtime ? "; started from the record file's mtime" : ""}`,
  };
}

export interface Imported {
  indexed: number;
  skipped: number;
  ignored: number;
  withLogs: number;
  commit: string | null;
}

export async function importEvidence(repo: Repo, dir: string, options: ImportOptions): Promise<Imported> {
  const ledger = await new Records(repo).readLedger();
  const task = findTask(findMilestone(ledger, options.milestone), options.task);
  if (task === undefined) throw new TallyError(`'${options.task}' is not planned in ${options.milestone}`);
  const absolute = resolve(repo.root, dir);
  const candidates: RunRecord[] = [];
  let ignored = 0;
  for (const jsonPath of await walkJson(absolute, options.flat === true)) {
    const record = await toRecord(repo, jsonPath, options, task.track);
    if (record === null) ignored += 1;
    else candidates.push(record);
  }
  const path = evidencePath(repo, options.milestone);
  const counts = await withLock(path, async () => {
    const file = await readEvidence(repo, options.milestone);
    const known = new Set(file.records.map((r) => r.id));
    const fresh = candidates.filter((r) => !known.has(r.id)).sort((a, b) => (a.started < b.started ? -1 : a.started > b.started ? 1 : 0));
    if (fresh.length > 0) await writeJsonAtomic(path, { ...file, records: [...file.records, ...fresh] });
    return { indexed: fresh.length, skipped: candidates.length - fresh.length, withLogs: fresh.filter((r) => r.log !== undefined).length };
  });
  const commit = counts.indexed === 0 ? null : await commitRecords(repo, `index ${counts.indexed} run records of ${options.milestone} '${options.task}' from ${relative(repo.root, absolute)}`);
  return { ...counts, ignored, commit };
}
