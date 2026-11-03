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
  by: z.string().optional(),
  on: z.string().optional(),
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

export interface DecisionInput {
  id: string;
  group: string;
  section?: string;
  text: string;
  since: string;
  status: string;
}

async function update<R>(repo: Repo, change: (file: DecisionsFile) => { file: DecisionsFile; result: R }): Promise<R> {
  const path = decisionsPath(repo);
  return withLock(path, async () => {
    const { file, result } = change(await readDecisions(repo));
    await writeJsonAtomic(path, decisionsFileSchema.parse(file));
    return result;
  });
}

const knownIn = (file: DecisionsFile, group: string): string => file.decisions.filter((d) => d.group === group).map((d) => d.id).join(", ") || "none";

function operatorOnly(authority: { operator: boolean }): void {
  if (!authority.operator) throw new TallyError("a decision is the operator's; pass --operator to record one");
}

export async function addDecision(repo: Repo, input: DecisionInput, authority: { operator: boolean }, now = new Date()): Promise<{ decision: Decision; commit: string | null }> {
  operatorOnly(authority);
  const decision: Decision = { ...input, state: stateOf(input.status), by: "operator", on: now.toISOString() };
  await update(repo, (file) => {
    if (file.decisions.some((d) => d.group === input.group && d.id === input.id)) throw new TallyError(`${input.group} already has decision ${input.id}; replace it instead`);
    return { file: { ...file, decisions: [...file.decisions, decision] }, result: undefined };
  });
  const commit = await commitRecords(repo, `decision ${input.id} (${input.group}) added`);
  return { decision, commit };
}

export async function replaceDecision(repo: Repo, input: DecisionInput & { why: string }, authority: { operator: boolean }, now = new Date()): Promise<{ decision: Decision; replaced: Replaced; commit: string | null }> {
  operatorOnly(authority);
  const { why, ...rest } = input;
  const result = await update(repo, (file) => {
    const old = file.decisions.find((d) => d.group === input.group && d.id === input.id);
    if (old === undefined) throw new TallyError(`${input.group} has no decision ${input.id}; known: ${knownIn(file, input.group)}`);
    const decision: Decision = { ...rest, ...(rest.section === undefined && old.section !== undefined ? { section: old.section } : {}), state: stateOf(input.status), by: "operator", on: now.toISOString() };
    const replaced: Replaced = { id: input.id, group: input.group, was: old.text, replaced: `${now.toISOString().slice(0, 10)}, by ${input.id}`, why };
    return { file: { ...file, decisions: file.decisions.map((d) => (d === old ? decision : d)), replaced: [...file.replaced, replaced] }, result: { decision, replaced } };
  });
  const commit = await commitRecords(repo, `decision ${input.id} (${input.group}) replaced`);
  return { ...result, commit };
}

export async function setDecisionStatus(repo: Repo, input: { id: string; group: string; status: string }, recorder: { by: string }, now = new Date()): Promise<{ decision: Decision; commit: string | null }> {
  const decision = await update(repo, (file) => {
    const old = file.decisions.find((d) => d.group === input.group && d.id === input.id);
    if (old === undefined) throw new TallyError(`${input.group} has no decision ${input.id}; known: ${knownIn(file, input.group)}`);
    const next: Decision = { ...old, status: input.status, state: stateOf(input.status), by: recorder.by, on: now.toISOString() };
    return { file: { ...file, decisions: file.decisions.map((d) => (d === old ? next : d)) }, result: next };
  });
  const commit = await commitRecords(repo, `decision ${input.id} (${input.group}): ${input.status}`);
  return { decision, commit };
}
