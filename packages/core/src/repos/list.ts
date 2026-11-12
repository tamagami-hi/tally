import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { gitOut } from "../git/run.ts";
import { StateFile } from "../state/file.ts";
import { listSessions } from "../state/sessions.ts";
import { CONFIG_FILE, RECORDS_DIR, openRepo } from "../store/records.ts";
import { realFolder, rootOfWorktree } from "./find.ts";
import { listPath, stateDirOf } from "./home.ts";
import { REPO_NAME, nameFromFolder } from "./name.ts";

export const repoEntrySchema = z.object({
  name: z.string().regex(REPO_NAME),
  root: z.string().min(1),
  addedAt: z.string(),
});

export const repoListSchema = z.object({
  schema: z.literal(1),
  default: z.string().regex(REPO_NAME).optional(),
  repos: z.array(repoEntrySchema),
});

export type RepoEntry = z.infer<typeof repoEntrySchema>;
export type RepoList = z.infer<typeof repoListSchema>;

export interface AddInput {
  root: string;
  name?: string;
}

const listFile = (home: string): StateFile<RepoList> => new StateFile(listPath(home), repoListSchema, () => ({ schema: 1, repos: [] }));

const withDefault = (repos: RepoEntry[], wanted: string | undefined): RepoList => {
  const kept = repos.find((repo) => repo.name === wanted)?.name ?? repos[0]?.name;
  return kept === undefined ? { schema: 1, repos } : { schema: 1, default: kept, repos };
};

export function unknownRepo(name: string, list: RepoList): TallyError {
  const listed = list.repos.map((repo) => repo.name).join(", ");
  return new TallyError(`no repository '${name}'; ${listed === "" ? "none is listed yet" : `listed: ${listed}`}`);
}

async function hasConfig(root: string): Promise<boolean> {
  try {
    await access(join(root, RECORDS_DIR, CONFIG_FILE));
    return true;
  } catch {
    return false;
  }
}

async function ownCheckout(path: string): Promise<string> {
  const folder = await realFolder(path);
  if ((await gitOut(folder, ["rev-parse", "--git-dir"])) === null) throw new TallyError(`${folder} is not a git repository`);
  const root = await rootOfWorktree(folder);
  const top = await gitOut(folder, ["rev-parse", "--show-toplevel"]);
  if (top !== null && top !== folder) throw new TallyError(`${folder} is inside the repository ${top}; add that folder`);
  if (root !== folder) throw new TallyError(`${folder} is a linked worktree of ${root}; add that repository`);
  return folder;
}

function checkedName(name: string): string {
  if (!REPO_NAME.test(name)) throw new TallyError(`a repository's name is lowercase letters, digits, - and _, and starts with a letter or a digit: '${name}'`);
  return name;
}

export function readRepoList(home: string): Promise<RepoList> {
  return listFile(home).read();
}

export async function addRepo(home: string, input: AddInput, now = new Date()): Promise<RepoEntry> {
  const root = await ownCheckout(input.root);
  const name = checkedName(input.name ?? nameFromFolder(root));
  if (!(await hasConfig(root))) throw new TallyError(`${root} has no ${RECORDS_DIR}/${CONFIG_FILE}`);
  await openRepo(root);
  const entry: RepoEntry = { name, root, addedAt: now.toISOString() };
  return listFile(home).update((list) => {
    const sameRoot = list.repos.find((repo) => repo.root === root);
    if (sameRoot !== undefined) throw new TallyError(`${root} is already listed as ${sameRoot.name}`);
    const sameName = list.repos.find((repo) => repo.name === name);
    if (sameName !== undefined) throw new TallyError(`the name ${name} is taken by ${sameName.root}`);
    return { value: withDefault([...list.repos, entry], list.default), result: entry };
  });
}

export async function removeRepo(home: string, name: string): Promise<RepoEntry> {
  return listFile(home).update(async (list) => {
    const entry = list.repos.find((repo) => repo.name === name);
    if (entry === undefined) throw unknownRepo(name, list);
    const open = (await listSessions({ stateDir: stateDirOf(home, name) })).length;
    if (open > 0) throw new TallyError(`${name} has ${open} open session${open === 1 ? "; close it" : "s; close them"} first`);
    return { value: withDefault(list.repos.filter((repo) => repo.name !== name), list.default), result: entry };
  });
}

export async function setDefaultRepo(home: string, name: string): Promise<RepoList> {
  return listFile(home).update((list) => {
    if (!list.repos.some((repo) => repo.name === name)) throw unknownRepo(name, list);
    const value = withDefault(list.repos, name);
    return { value, result: value };
  });
}
