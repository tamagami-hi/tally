import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { commitRecords } from "./commit.ts";
import { parseTables, renderRow } from "./markdown.ts";

export const decisionSchema = z.object({
  id: z.string().min(1),
  group: z.string().min(1),
  section: z.string().optional(),
  text: z.string(),
  since: z.string(),
  status: z.string(),
  state: z.enum(["in force", "built", "partly built", "decided, not built", "other"]),
});

export const replacedSchema = z.object({
  id: z.string().min(1),
  group: z.string().min(1),
  was: z.string(),
  replaced: z.string(),
  why: z.string(),
});

export const decisionsFileSchema = z.object({
  schema: z.literal(1),
  decisions: z.array(decisionSchema).default([]),
  replaced: z.array(replacedSchema).default([]),
});

export type Decision = z.infer<typeof decisionSchema>;
export type Replaced = z.infer<typeof replacedSchema>;
export type DecisionsFile = z.infer<typeof decisionsFileSchema>;

export const decisionsPath = (repo: Repo): string => join(repo.recordsDir, "decisions.json");

export function stateOf(status: string): Decision["state"] {
  const head = status.toLowerCase();
  if (head.startsWith("in force")) return "in force";
  if (head.startsWith("partly built") || head.startsWith("decided, partly built")) return "partly built";
  if (head.startsWith("built")) return "built";
  if (head.startsWith("decided, not built") || head.startsWith("decided")) return "decided, not built";
  return "other";
}

export function parseDecisions(text: string, group: string): { decisions: Decision[]; replaced: Replaced[]; lines: Map<string, { line: number; rendered: string }> } {
  const decisions: Decision[] = [];
  const replaced: Replaced[] = [];
  const lines = new Map<string, { line: number; rendered: string }>();
  for (const table of parseTables(text)) {
    const header = table.header.map((h) => h.toLowerCase());
    if (header[0] !== "id") continue;
    for (const { line, cells } of table.rows) {
      if (header[1] === "was") {
        const [id = "", was = "", when = "", why = ""] = cells;
        replaced.push({ id, group, was, replaced: when, why });
        lines.set(`replaced:${id}:${line}`, { line, rendered: renderRow([id, was, when, why]) });
      } else {
        const [id = "", body = "", since = "", status = ""] = cells;
        decisions.push({ id, group, ...(table.section === undefined ? {} : { section: table.section }), text: body, since, status, state: stateOf(status) });
        lines.set(`decision:${id}`, { line, rendered: renderRow([id, body, since, status]) });
      }
    }
  }
  return { decisions, replaced, lines };
}

export async function readDecisions(repo: Repo): Promise<DecisionsFile> {
  try {
    return await readJson(decisionsPath(repo), decisionsFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, decisions: [], replaced: [] };
    throw error;
  }
}

export async function importDecisions(repo: Repo, file: string, group: string): Promise<{ decisions: number; replaced: number; commit: string | null }> {
  const text = await readFile(file, "utf8");
  const parsed = parseDecisions(text, group);
  if (parsed.decisions.length === 0) throw new TallyError(`${file} holds no decision rows (a table headed id | decision | since | status)`);
  const original = text.split("\n");
  for (const [key, { line, rendered }] of parsed.lines) {
    if ((original[line - 1] ?? "").trim() !== rendered) throw new TallyError(`${file} line ${line} (${key}) does not render back as it is; refusing to import a lossy read`);
  }
  const path = decisionsPath(repo);
  await withLock(path, async () => {
    const current = await readDecisions(repo);
    const next: DecisionsFile = {
      schema: 1,
      decisions: [...current.decisions.filter((d) => d.group !== group), ...parsed.decisions],
      replaced: [...current.replaced.filter((r) => r.group !== group), ...parsed.replaced],
    };
    await writeJsonAtomic(path, next);
  });
  const commit = await commitRecords(repo, `import ${group}'s decisions`);
  return { decisions: parsed.decisions.length, replaced: parsed.replaced.length, commit };
}
