import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readQuestions } from "../records/questions.ts";
import type { Repo } from "../store/records.ts";

export interface OpenQuestions {
  rows: string[];
  nextRow: number | null;
}

async function questionFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await questionFiles(path)));
    else if (entry.name === "questions.md") found.push(path);
  }
  return found.sort();
}

export async function questionsFromMarkdown(docsDir: string): Promise<OpenQuestions> {
  const rows: string[] = [];
  let nextRow: number | null = null;
  for (const file of await questionFiles(docsDir)) {
    const text = await readFile(file, "utf8");
    const group = file.split("/").at(-2) ?? "";
    for (const match of text.matchAll(/^\| (\d+) \| /gm)) rows.push(`${match[1]} (${group})`);
    const next = /the next is (\d+)/.exec(text);
    if (next !== null) nextRow = Math.max(nextRow ?? 0, Number(next[1]));
  }
  return { rows, nextRow };
}

export async function openQuestions(repo: Repo): Promise<OpenQuestions> {
  const records = await readQuestions(repo);
  if (records !== null) return { rows: records.open.map((q) => `${q.row} (${q.group})`), nextRow: records.nextRow };
  return questionsFromMarkdown(join(repo.root, repo.config.docsDir));
}
