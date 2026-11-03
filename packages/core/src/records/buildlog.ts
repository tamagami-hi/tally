import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { commitRecords } from "./commit.ts";
import { blob } from "./sections.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEADING = /^## (.+?)\. (.+), (\d{4}-\d{2}-\d{2})$/;
const SHAPE = "## <milestone>. <title>, <YYYY-MM-DD>";

export const buildlogEntrySchema = z.object({
  group: z.string().min(1),
  milestone: z.string().min(1),
  title: z.string().min(1),
  date: z.string().regex(DATE),
  markdown: z.string(),
  commits: z.array(z.string().min(7)).default([]),
});

export const buildlogFileSchema = z.object({
  schema: z.literal(1),
  preambles: z.array(z.object({ group: z.string().min(1), markdown: z.string() })).default([]),
  entries: z.array(buildlogEntrySchema).default([]),
});

export type BuildlogEntry = z.infer<typeof buildlogEntrySchema>;
export type BuildlogFile = z.infer<typeof buildlogFileSchema>;

export const buildlogPath = (repo: Repo): string => join(repo.recordsDir, "buildlog.json");

export function parseBuildlog(text: string, group: string): { preamble: string; entries: BuildlogEntry[] } {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const headings = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.startsWith("## "));
  const entries = headings.map(({ line, index }, n) => {
    const match = HEADING.exec(line);
    if (match === null) throw new TallyError(`line ${index + 1}: '${line}' is not '${SHAPE}'`);
    const [, milestone = "", title = "", date = ""] = match;
    const end = headings[n + 1]?.index ?? lines.length;
    return { group, milestone, title, date, markdown: blob(lines.slice(index + 1, end)), commits: [] };
  });
  return { preamble: blob(lines.slice(0, headings[0]?.index ?? lines.length)), entries };
}

const heading = (entry: BuildlogEntry): string => `## ${entry.milestone}. ${entry.title}, ${entry.date}`;

export function renderBuildlog(file: BuildlogFile, group: string): string {
  const preamble = file.preambles.find((p) => p.group === group);
  const entries = file.entries.filter((e) => e.group === group);
  if (preamble === undefined && entries.length === 0) {
    const known = [...new Set([...file.preambles.map((p) => p.group), ...file.entries.map((e) => e.group)])].sort();
    throw new TallyError(`no build log for group '${group}'; known: ${known.join(", ") || "none"}`);
  }
  const blocks = [preamble?.markdown ?? `# ${group}: build log`, ...entries.map((e) => (e.markdown === "" ? heading(e) : `${heading(e)}\n\n${e.markdown}`))];
  return `${blocks.join("\n\n")}\n`;
}

export async function readBuildlog(repo: Repo): Promise<BuildlogFile> {
  try {
    return await readJson(buildlogPath(repo), buildlogFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, preambles: [], entries: [] };
    throw error;
  }
}

async function update<R>(repo: Repo, change: (file: BuildlogFile) => { file: BuildlogFile; result: R }): Promise<R> {
  const path = buildlogPath(repo);
  return withLock(path, async () => {
    const { file, result } = change(await readBuildlog(repo));
    await writeJsonAtomic(path, buildlogFileSchema.parse(file));
    return result;
  });
}

export async function importBuildlog(repo: Repo, file: string, group: string): Promise<{ entries: number; commit: string | null }> {
  const text = await readFile(file, "utf8");
  let parsed: { preamble: string; entries: BuildlogEntry[] };
  try {
    parsed = parseBuildlog(text, group);
  } catch (error: unknown) {
    throw new TallyError(`${file} ${error instanceof Error ? error.message : String(error)}`);
  }
  if (renderBuildlog({ schema: 1, preambles: [{ group, markdown: parsed.preamble }], entries: parsed.entries }, group) !== text) throw new TallyError(`${file} does not render back as it is; refusing to import a lossy read`);
  await update(repo, (current) => ({
    file: {
      schema: 1,
      preambles: [...current.preambles.filter((p) => p.group !== group), { group, markdown: parsed.preamble }],
      entries: [...current.entries.filter((e) => e.group !== group), ...parsed.entries],
    },
    result: undefined,
  }));
  const commit = await commitRecords(repo, `import ${group}'s build log`);
  return { entries: parsed.entries.length, commit };
}

export interface AppendInput {
  group: string;
  milestone: string;
  title: string;
  date: string;
  markdown: string;
  commits?: readonly string[];
}

export async function appendBuildlog(repo: Repo, input: AppendInput): Promise<{ entry: BuildlogEntry; commit: string | null }> {
  if (!DATE.test(input.date)) throw new TallyError(`the date must be YYYY-MM-DD, not '${input.date}'`);
  const markdown = blob(input.markdown.split("\n"));
  if (markdown === "") throw new TallyError("a build log entry needs a body");
  const entry: BuildlogEntry = { group: input.group, milestone: input.milestone, title: input.title, date: input.date, markdown, commits: [...(input.commits ?? [])] };
  await update(repo, (current) => {
    if (current.entries.some((e) => e.group === input.group && e.milestone === input.milestone)) throw new TallyError(`${input.group}'s build log already has a section for ${input.milestone}`);
    return { file: { ...current, entries: [...current.entries, entry] }, result: undefined };
  });
  const commit = await commitRecords(repo, `${input.group} build log: ${input.milestone}`);
  return { entry, commit };
}
