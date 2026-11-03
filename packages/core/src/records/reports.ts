import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { Records, type Repo } from "../store/records.ts";
import { commitRecords } from "./commit.ts";
import { listEvidence } from "./evidence.ts";
import { safeName } from "./handoffs.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const bundledFileSchema = z.object({ path: z.string().min(1), sha256: z.string().length(64), bytes: z.number().int().nonnegative() });

export const reportManifestSchema = z.object({
  schema: z.literal(1),
  date: z.string().regex(DATE),
  name: z.string().min(1),
  group: z.string().min(1),
  narrative: z.string().min(1),
  fingerprint: z.string().optional(),
  cites: z.object({ evidence: z.array(z.string()), decisions: z.array(z.string()), questions: z.array(z.number().int()) }),
  bundled: z.array(bundledFileSchema),
});

export type ReportManifest = z.infer<typeof reportManifestSchema>;

export interface ReportInput {
  date: string;
  name: string;
  group: string;
  narrative: string;
  bundle?: string;
  fingerprint?: string;
  evidence?: readonly { milestone: string; task?: string }[];
  decisions?: readonly string[];
  questions?: readonly number[];
}

export const reportPath = (repo: Repo, date: string, name: string): string => join(repo.recordsDir, "reports", date, `${safeName(name)}.json`);

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

async function bundled(repo: Repo, bundle: string): Promise<ReportManifest["bundled"]> {
  const absolute = resolve(repo.root, bundle);
  const rel = relative(repo.root, absolute);
  if (!rel.startsWith(`${repo.config.docsDir}${sep}`)) throw new TallyError(`the bundle must be a folder inside ${repo.config.docsDir}/: ${bundle}`);
  let listed: string[];
  try {
    listed = await files(absolute);
  } catch {
    throw new TallyError(`the bundle ${bundle} cannot be read`);
  }
  const hashed = [];
  for (const file of listed.sort()) {
    const bytes = await readFile(file);
    hashed.push({ path: relative(repo.root, file), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  }
  return hashed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function citedEvidence(repo: Repo, cites: readonly { milestone: string; task?: string }[]): Promise<string[]> {
  const ledger = await new Records(repo).readLedger();
  const ids: string[] = [];
  for (const cite of cites) {
    const milestone = findMilestone(ledger, cite.milestone);
    if (cite.task !== undefined && findTask(milestone, cite.task) === undefined) throw new TallyError(`'${cite.task}' is not planned in ${cite.milestone}`);
    ids.push(...(await listEvidence(repo, cite.milestone, cite.task)).map((r) => r.id));
  }
  return ids;
}

export async function writeReportManifest(repo: Repo, input: ReportInput): Promise<{ manifest: ReportManifest; path: string; commit: string | null }> {
  if (!DATE.test(input.date)) throw new TallyError(`the date must be YYYY-MM-DD, not '${input.date}'`);
  try {
    await stat(resolve(repo.root, input.narrative));
  } catch {
    throw new TallyError(`the narrative ${input.narrative} does not exist`);
  }
  const manifest: ReportManifest = {
    schema: 1,
    date: input.date,
    name: input.name,
    group: input.group,
    narrative: input.narrative,
    ...(input.fingerprint === undefined ? {} : { fingerprint: input.fingerprint }),
    cites: { evidence: await citedEvidence(repo, input.evidence ?? []), decisions: [...(input.decisions ?? [])], questions: [...(input.questions ?? [])] },
    bundled: input.bundle === undefined ? [] : await bundled(repo, input.bundle),
  };
  const path = reportPath(repo, input.date, input.name);
  await withLock(path, () => writeJsonAtomic(path, reportManifestSchema.parse(manifest)));
  const commit = await commitRecords(repo, `report ${input.date}/${input.name}: manifest`);
  return { manifest, path, commit };
}

export async function readReportManifest(repo: Repo, date: string, name: string): Promise<ReportManifest> {
  return readJson(reportPath(repo, date, name), reportManifestSchema);
}
