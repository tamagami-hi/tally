import { access, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { CONFIG_FILE, RECORDS_DIR, TallyError, realFolder, type Repos } from "@tally/core";

export interface Folder {
  name: string;
  path: string;
  isRepo: boolean;
  hasRecords: boolean;
  listed: string | null;
}

export interface Listing {
  dir: string;
  parent: string | null;
  folders: Folder[];
}

async function present(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function insideWorkspace(workspace: string, path: string): Promise<string> {
  const root = await realFolder(workspace);
  const folder = await realFolder(path).catch(() => undefined);
  if (folder === undefined || (folder !== root && !folder.startsWith(`${root}${sep}`))) throw new TallyError(`${resolve(path)} is not a folder inside the workspace ${root}`);
  return folder;
}

export async function listFolders(workspace: string, repos: Repos, dir: string | undefined): Promise<Listing> {
  const root = await realFolder(workspace);
  const folder = await insideWorkspace(root, dir ?? root);
  const listed = new Map((await repos.entries()).map((entry) => [entry.root, entry.name]));
  const names = (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
  const folders: Folder[] = [];
  for (const name of names) {
    const path = join(folder, name);
    folders.push({ name, path, isRepo: await present(join(path, ".git")), hasRecords: await present(join(path, RECORDS_DIR, CONFIG_FILE)), listed: listed.get(path) ?? null });
  }
  return { dir: folder, parent: folder === root ? null : dirname(folder), folders };
}
