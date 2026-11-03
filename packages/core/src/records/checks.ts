import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { gitMust } from "../git/run.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { commitRecords } from "./commit.ts";
import { blob, renderTable, splitSections, stripCode, takeTable, type Section } from "./sections.ts";

export const checkRowSchema = z.object({ name: z.string(), result: z.string() });
export const suiteSchema = z.object({ name: z.string(), where: z.string(), tests: z.string(), count: z.number().int().nonnegative().nullable() });
export const moduleFileSchema = z.object({ path: z.string(), lines: z.number().int().nonnegative(), covered: z.string(), tests: z.string().optional() });
export const noteSchema = z.object({ label: z.string(), text: z.string() });
export const moduleSchema = z.object({
  name: z.string().min(1),
  header: z.array(z.string()).min(3),
  files: z.array(moduleFileSchema),
  body: z.string(),
  tests: z.array(z.string()),
  entryPoints: z.array(z.string()),
  gaps: z.array(z.string()),
  notes: z.array(noteSchema),
});
export const checksFileSchema = z.object({
  schema: z.literal(1),
  title: z.string(),
  intro: z.string(),
  fingerprint: z.string().min(7),
  fingerprintFull: z.string().optional(),
  verifiedBy: z.string(),
  recorded: z.string(),
  staleWhen: z.string().optional(),
  fingerprintRows: z.array(z.object({ key: z.string(), value: z.string() })),
  command: z.string().optional(),
  checks: z.array(checkRowSchema),
  checksNote: z.string(),
  suites: z.array(suiteSchema),
  suitesNote: z.string(),
  modulesIntro: z.string(),
  modules: z.array(moduleSchema),
});

export type ChecksFile = z.infer<typeof checksFileSchema>;
export type ChecksModule = z.infer<typeof moduleSchema>;

const HEADINGS = { fingerprint: "The fingerprint", checks: "The checks", suites: "The test suites", modules: "The modules" };
const GAP_LABELS = ["open", "weakest", "remaining coverage"];

export const checksPath = (repo: Repo): string => join(repo.recordsDir, "checks.json");

function section(sections: Section[], heading: string): Section {
  const found = sections.find((s) => s.heading === heading);
  if (found === undefined) throw new TallyError(`no '## ${heading}' section`);
  return found;
}

function fenced(lines: readonly string[], from: number): string | undefined {
  const open = lines.findIndex((line, i) => i >= from && line.startsWith("```"));
  if (open < 0) return undefined;
  const close = lines.findIndex((line, i) => i > open && line === "```");
  if (close < 0) throw new TallyError("the fingerprint's command block is not closed");
  return lines.slice(open + 1, close).join("\n");
}

function bullets(body: string): { entryPoints: string[]; gaps: string[]; notes: { label: string; text: string }[] } {
  const found: { label: string; text: string }[] = [];
  let current: { label: string; text: string } | undefined;
  for (const line of body.split("\n")) {
    const bold = /^- \*\*(.+?)\*\*(.*)$/.exec(line);
    if (bold !== null) {
      const [, head = "", rest = ""] = bold;
      const colon = rest.indexOf(":");
      current = head.endsWith(":") ? { label: head.slice(0, -1), text: rest.trim() } : colon < 0 ? { label: head, text: rest.trim() } : { label: `${head}${rest.slice(0, colon)}`.trim(), text: rest.slice(colon + 1).trim() };
      found.push(current);
    } else if (current !== undefined && /^\s+/.test(line)) {
      const more = line.trim().replace(/^- /, "");
      current.text = current.text === "" ? more : `${current.text} ${more}`;
    } else current = undefined;
  }
  const kind = (label: string): "entry" | "gap" | "note" => {
    const low = label.toLowerCase();
    return low.startsWith("entry point") ? "entry" : GAP_LABELS.some((g) => low.startsWith(g)) ? "gap" : "note";
  };
  return {
    entryPoints: found.filter((b) => kind(b.label) === "entry").map((b) => b.text),
    gaps: found.filter((b) => kind(b.label) === "gap").map((b) => `${b.label}: ${b.text}`),
    notes: found.filter((b) => kind(b.label) === "note"),
  };
}

function parseModule(heading: string, lines: readonly string[]): ChecksModule {
  const start = lines.findIndex((line) => line.startsWith("|"));
  if (start < 0) throw new TallyError(`module '${heading}' has no file table`);
  const table = takeTable(lines, start, `module '${heading}'`);
  const files = table.rows.map(([path = "", linesCell = "", covered = "", tests]) => {
    const count = Number(linesCell);
    if (!Number.isInteger(count) || count < 0) throw new TallyError(`module '${heading}': ${path} has lines '${linesCell}', not a number`);
    return { path: stripCode(path), lines: count, covered, ...(tests === undefined ? {} : { tests }) };
  });
  const body = blob(lines.slice(table.end));
  const tests = [...new Set(files.flatMap((f) => [...(f.tests ?? "").matchAll(/`([^`]+)` \d+/g)].map((m) => m[1] ?? "")))];
  return { name: heading, header: table.header, files, body, tests, ...bullets(body) };
}

export function parseChecks(text: string): ChecksFile {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const title = lines[0];
  if (title === undefined || !title.startsWith("# ")) throw new TallyError("the first line must be the '# ' title");
  const { before, sections } = splitSections(lines.slice(1), "## ");
  const fingerprintSection = section(sections, HEADINGS.fingerprint);
  const fingerprintTable = takeTable(fingerprintSection.lines, fingerprintSection.lines.findIndex((l) => l.startsWith("|")), HEADINGS.fingerprint);
  const rows = fingerprintTable.rows.map(([key = "", value = ""]) => ({ key: key.replace(/^\*\*(.*)\*\*$/, "$1"), value }));
  const row = (key: string): string | undefined => rows.find((r) => r.key === key)?.value;
  const code = row("Code fingerprint");
  if (code === undefined) throw new TallyError("no Code fingerprint row in the fingerprint table");
  const short = /`([0-9a-f]{7,40})`/.exec(code)?.[1];
  if (short === undefined) throw new TallyError("the Code fingerprint row names no commit in backticks");
  const full = /`([0-9a-f]{40})`/.exec(code)?.[1];
  const command = fenced(fingerprintSection.lines, fingerprintTable.end);
  const checksSection = section(sections, HEADINGS.checks);
  const checksTable = takeTable(checksSection.lines, checksSection.lines.findIndex((l) => l.startsWith("|")), HEADINGS.checks);
  const suitesSection = section(sections, HEADINGS.suites);
  const suitesTable = takeTable(suitesSection.lines, suitesSection.lines.findIndex((l) => l.startsWith("|")), HEADINGS.suites);
  const modulesSection = section(sections, HEADINGS.modules);
  const modules = splitSections(modulesSection.lines, "### ");
  const staleWhen = row("Stale when");
  return {
    schema: 1,
    title: title.slice(2),
    intro: blob(before),
    fingerprint: short,
    ...(full === undefined ? {} : { fingerprintFull: full }),
    verifiedBy: row("Verified by") ?? "",
    recorded: row("Recorded") ?? "",
    ...(staleWhen === undefined ? {} : { staleWhen }),
    fingerprintRows: rows,
    ...(command === undefined ? {} : { command }),
    checks: checksTable.rows.map(([name = "", result = ""]) => ({ name, result })),
    checksNote: blob(checksSection.lines.slice(checksTable.end)),
    suites: suitesTable.rows.map(([name = "", where = "", tests = ""]) => ({ name, where, tests, count: /^\d+/.test(tests) ? Number(/^\d+/.exec(tests)![0]) : null })),
    suitesNote: blob(suitesSection.lines.slice(suitesTable.end)),
    modulesIntro: blob(modules.before),
    modules: modules.sections.map((m) => parseModule(m.heading, m.lines)),
  };
}

export function renderChecks(record: ChecksFile): string {
  const blocks: string[] = [`# ${record.title}`];
  const push = (text: string): void => {
    if (text !== "") blocks.push(text);
  };
  push(record.intro);
  blocks.push(`## ${HEADINGS.fingerprint}`, renderTable(["", ""], record.fingerprintRows.map((r) => [`**${r.key}**`, r.value]), "| | |"));
  if (record.command !== undefined) blocks.push(`\`\`\`bash\n${record.command}\n\`\`\``);
  blocks.push(`## ${HEADINGS.checks}`, renderTable(["Check", "Result"], record.checks.map((c) => [c.name, c.result])));
  push(record.checksNote);
  blocks.push(`## ${HEADINGS.suites}`, renderTable(["Suite", "Where", "Tests"], record.suites.map((s) => [s.name, s.where, s.tests])));
  push(record.suitesNote);
  blocks.push(`## ${HEADINGS.modules}`);
  push(record.modulesIntro);
  for (const module of record.modules) {
    blocks.push(`### ${module.name}`, renderTable(module.header, module.files.map((f) => [`\`${f.path}\``, String(f.lines), f.covered, ...(f.tests === undefined ? [] : [f.tests])])));
    push(module.body);
  }
  return `${blocks.join("\n\n")}\n`;
}

export async function readChecks(repo: Repo): Promise<ChecksFile | null> {
  try {
    return await readJson(checksPath(repo), checksFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return null;
    throw error;
  }
}

export async function fingerprintAtMain(repo: Repo): Promise<string> {
  const { paths, exclude } = repo.config.fingerprint;
  return gitMust(repo.root, ["log", "-1", "--format=%h", repo.config.mainBranch, "--", ...paths, ...exclude.map((pattern) => `:(exclude)${pattern}`)]);
}

async function write(repo: Repo, record: ChecksFile, message: string): Promise<string | null> {
  const path = checksPath(repo);
  await withLock(path, () => writeJsonAtomic(path, checksFileSchema.parse(record)));
  return commitRecords(repo, message);
}

export async function importChecks(repo: Repo, file: string): Promise<{ fingerprint: string; checks: number; suites: number; modules: number; files: number; commit: string | null }> {
  const text = await readFile(file, "utf8");
  const record = parseChecks(text);
  const rendered = renderChecks(record);
  if (rendered !== text) {
    const original = text.split("\n");
    const line = rendered.split("\n").findIndex((l, i) => l !== original[i]) + 1;
    throw new TallyError(`${file} line ${line} does not render back as it is; refusing to import a lossy read`);
  }
  const commit = await write(repo, record, `import the code-check record at ${record.fingerprint}`);
  return { fingerprint: record.fingerprint, checks: record.checks.length, suites: record.suites.length, modules: record.modules.length, files: record.modules.reduce((n, m) => n + m.files.length, 0), commit };
}

export async function setChecks(repo: Repo, input: unknown): Promise<{ fingerprint: string; commit: string | null }> {
  const record = checksFileSchema.parse(input);
  const main = await fingerprintAtMain(repo);
  if (record.fingerprint !== main) throw new TallyError(`the record's fingerprint ${record.fingerprint} is not what git log prints for the config's paths at main (${main}); verify main's code first`);
  const commit = await write(repo, record, `checks set at ${record.fingerprint}`);
  return { fingerprint: record.fingerprint, commit };
}

export async function checksFingerprint(repo: Repo): Promise<{ record: string | null; main: string; stands: boolean }> {
  const record = await readChecks(repo);
  const main = await fingerprintAtMain(repo);
  return { record: record?.fingerprint ?? null, main, stands: record !== null && record.fingerprint === main };
}
