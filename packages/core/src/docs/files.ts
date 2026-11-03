import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";

const ROOT_FILES = ["RULES.md", "CLAUDE.md", "README.md"];
const EXTENSIONS = [".md", ".json"];

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path)));
    else if (entry.isFile() && EXTENSIONS.some((e) => entry.name.endsWith(e))) found.push(path);
  }
  return found;
}

export async function listDocs(repo: Repo): Promise<string[]> {
  const roots: string[] = [];
  for (const name of ROOT_FILES) {
    try {
      await readFile(join(repo.root, name), "utf8");
      roots.push(name);
    } catch {
      continue;
    }
  }
  const inside = (await walk(join(repo.root, repo.config.docsDir))).map((p) => relative(repo.root, p));
  return [...roots, ...inside.sort()];
}

function isDocument(repo: Repo, rel: string): boolean {
  return ROOT_FILES.includes(rel) || (rel.startsWith(`${repo.config.docsDir}${sep}`) && EXTENSIONS.some((e) => rel.endsWith(e)));
}

export async function docPath(repo: Repo, path: string): Promise<string> {
  const absolute = resolve(repo.root, path);
  const rel = relative(repo.root, absolute);
  if (rel.startsWith("..") || !isDocument(repo, rel)) throw new TallyError(`${path} is not a document: only ${ROOT_FILES.join(", ")} and ${repo.config.docsDir}/**/*.md|json are`);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw new TallyError(`${path} does not exist`);
  }
  const realRel = relative(await realpath(repo.root), real);
  if (realRel.startsWith("..")) throw new TallyError(`${path} points outside the repository`);
  if (!isDocument(repo, realRel)) throw new TallyError(`${path} is a link to ${realRel}, which is not a document`);
  return absolute;
}

export async function readDoc(repo: Repo, path: string): Promise<{ path: string; text: string }> {
  const absolute = await docPath(repo, path);
  return { path: relative(repo.root, absolute), text: await readFile(absolute, "utf8") };
}

export interface Hit {
  path: string;
  line: number;
  text: string;
}

export async function searchDocs(repo: Repo, query: string, limit = 50): Promise<Hit[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) throw new TallyError("the search needs a query");
  const hits: Hit[] = [];
  for (const path of await listDocs(repo)) {
    const lines = (await readFile(join(repo.root, path), "utf8")).split("\n");
    lines.forEach((text, i) => {
      if (hits.length < limit && text.toLowerCase().includes(needle)) hits.push({ path, line: i + 1, text: text.trim().slice(0, 240) });
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
