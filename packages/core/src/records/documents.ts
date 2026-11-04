import { readFile } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import { z } from "zod";
import { listDocs } from "../docs/files.ts";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { commitRecords } from "./commit.ts";
import { parseTables } from "./markdown.ts";

export const documentKinds = ["root", "front", "record", "next", "completed", "reference", "manual", "report", "other"] as const;

export const documentSchema = z.object({
  path: z.string().min(1),
  group: z.string().min(1),
  kind: z.enum(documentKinds),
  title: z.string(),
  purpose: z.string().optional(),
  preamble: z.string().optional(),
});

export const documentsFileSchema = z.object({ schema: z.literal(1), documents: z.array(documentSchema).default([]) });

export type DocumentKind = (typeof documentKinds)[number];
export type DocumentRow = z.infer<typeof documentSchema>;
export type DocumentsFile = z.infer<typeof documentsFileSchema>;

const RECORD_FILE = /^(decisions|questions|build-log|code-checks)\.md$/;
const PROSE_RECORD = /^(decisions|questions)\.md$/;
const FOLDER_KINDS: readonly DocumentKind[] = ["next", "completed", "reference", "manual"];
const LINK = /\[[^\]]*\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/;

export const documentsPath = (repo: Repo): string => join(repo.recordsDir, "documents.json");

export async function readDocuments(repo: Repo): Promise<DocumentsFile> {
  try {
    return await readJson(documentsPath(repo), documentsFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, documents: [] };
    throw error;
  }
}

function kindOf(repo: Repo, path: string): DocumentKind {
  const folders = path.split("/").slice(0, -1);
  const name = basename(path);
  if (folders.length === 0) return "root";
  if (RECORD_FILE.test(name)) return "record";
  if (folders.includes("reports")) return "report";
  const folder = FOLDER_KINDS.find((kind) => folders.includes(kind));
  if (folder !== undefined) return folder;
  if (name === "README.md") return "front";
  return folders[0] === repo.config.docsDir ? "other" : "manual";
}

function groupOf(repo: Repo, path: string): string {
  const parts = path.split("/");
  if (parts.length === 1) return "root";
  if (parts[0] !== repo.config.docsDir) return parts[0] ?? "root";
  return parts.length === 2 ? repo.config.docsDir : (parts[1] ?? repo.config.docsDir);
}

function preambleOf(lines: readonly string[]): string {
  const title = lines.findIndex((line) => line.startsWith("# "));
  const body = lines.slice(title + 1);
  const end = body.findIndex((line) => line.startsWith("## ") || /^\|\s*#\s*\|/.test(line));
  return (end === -1 ? body : body.slice(0, end)).join("\n").trim();
}

function purposesIn(index: string, text: string): [string, string][] {
  const found: [string, string][] = [];
  for (const table of parseTables(text)) {
    for (const { cells } of table.rows) {
      const link = LINK.exec(cells[0] ?? "")?.[1];
      const purpose = cells[cells.length - 1];
      if (link !== undefined && purpose !== undefined && cells.length > 1) found.push([normalize(join(dirname(index), link)), purpose]);
    }
  }
  return found;
}

export async function scanDocuments(repo: Repo): Promise<{ documents: number; purposes: number; commit: string | null }> {
  const paths = (await listDocs(repo)).filter((path) => path.endsWith(".md")).sort();
  const texts = new Map(await Promise.all(paths.map(async (path): Promise<[string, string]> => [path, await readFile(join(repo.root, path), "utf8")])));
  const purposes = new Map<string, string>();
  for (const [path, text] of texts) {
    if (basename(path) !== "README.md") continue;
    for (const [target, purpose] of purposesIn(path, text)) if (!purposes.has(target)) purposes.set(target, purpose);
  }
  const documents = paths.map((path): DocumentRow => {
    const lines = (texts.get(path) ?? "").split("\n");
    const purpose = purposes.get(path);
    return {
      path,
      group: groupOf(repo, path),
      kind: kindOf(repo, path),
      title: (lines.find((line) => line.startsWith("# ")) ?? "# ").slice(2),
      ...(purpose === undefined ? {} : { purpose }),
      ...(PROSE_RECORD.test(basename(path)) ? { preamble: preambleOf(lines) } : {}),
    };
  });
  const file = documentsPath(repo);
  await withLock(file, () => writeJsonAtomic(file, documentsFileSchema.parse({ schema: 1, documents })));
  const commit = await commitRecords(repo, "scan the documents");
  return { documents: documents.length, purposes: documents.filter((d) => d.purpose !== undefined).length, commit };
}
