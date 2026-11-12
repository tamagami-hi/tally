import { TallyError } from "../errors.ts";
import { openRepo, type Repo } from "../store/records.ts";
import { realFolder, rootOfWorktree } from "./find.ts";
import { stateDirOf } from "./home.ts";
import { readRepoList, type RepoEntry, type RepoList } from "./list.ts";

export function entryForRoot(list: RepoList, root: string): RepoEntry {
  const entry = list.repos.find((repo) => repo.root === root);
  if (entry === undefined) throw new TallyError(`${root} is not a repository tally tracks; add it in the sidebar, or with: tally repo add ${/\s/.test(root) ? `'${root}'` : root}`);
  return entry;
}

export async function findRepo(home: string, path: string): Promise<RepoEntry> {
  return entryForRoot(await readRepoList(home), await rootOfWorktree(path));
}

export async function openAt(home: string, root: string): Promise<Repo> {
  const folder = await realFolder(root).catch(() => undefined);
  const entry = folder === undefined ? undefined : (await readRepoList(home)).repos.find((repo) => repo.root === folder);
  return entry === undefined ? openRepo(root) : openRepo(entry.root, { name: entry.name, stateDir: stateDirOf(home, entry.name) });
}
