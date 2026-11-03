import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { commitRecords } from "./commit.ts";

export const planSchema = z.object({
  path: z.string().min(1),
  group: z.string().min(1),
  status: z.enum(["next", "completed"]),
  title: z.string(),
  statusLine: z.string(),
});

export const plansFileSchema = z.object({ schema: z.literal(1), plans: z.array(planSchema).default([]) });

export type Plan = z.infer<typeof planSchema>;
export type PlansFile = z.infer<typeof plansFileSchema>;

const PLAN_PATH = /^([^/]+)\/(next|completed)\/.+\.md$/;

export const plansPath = (repo: Repo): string => join(repo.recordsDir, "plans.json");

async function markdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

export async function readPlans(repo: Repo): Promise<PlansFile> {
  try {
    return await readJson(plansPath(repo), plansFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, plans: [] };
    throw error;
  }
}

export async function scanPlans(repo: Repo): Promise<{ next: number; completed: number; commit: string | null }> {
  const docs = join(repo.root, repo.config.docsDir);
  const plans: Plan[] = [];
  for (const file of await markdownFiles(docs)) {
    const inDocs = relative(docs, file);
    const match = PLAN_PATH.exec(inDocs);
    if (match === null) continue;
    const [, group = "", status = "next"] = match;
    const lines = (await readFile(file, "utf8")).split("\n");
    plans.push({
      path: relative(repo.root, file),
      group,
      status: status === "completed" ? "completed" : "next",
      title: (lines.find((l) => l.startsWith("# ")) ?? "# ").slice(2),
      statusLine: lines.find((l) => l.startsWith("**Status")) ?? "",
    });
  }
  plans.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const path = plansPath(repo);
  await withLock(path, () => writeJsonAtomic(path, plansFileSchema.parse({ schema: 1, plans })));
  const commit = await commitRecords(repo, "scan the plans");
  return { next: plans.filter((p) => p.status === "next").length, completed: plans.filter((p) => p.status === "completed").length, commit };
}
