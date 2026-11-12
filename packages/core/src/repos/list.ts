import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { gitOut } from "../git/run.ts";
import { StateFile } from "../state/file.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { listSessions } from "../state/sessions.ts";
import { CONFIG_FILE, RECORDS_DIR, openRepo } from "../store/records.ts";
import { gitIn, realFolder, rootOfWorktree } from "./find.ts";
import { STATE_DIR, listPath, ownerPath, stateDirOf } from "./home.ts";
import { REPO_NAME, nameFromFolder } from "./name.ts";

export const repoEntrySchema = z.object({
  name: z.string().regex(REPO_NAME),
  root: z.string().min(1),
  addedAt: z.string(),
});

export const repoListSchema = z
  .object({
    schema: z.literal(1),
    default: z.string().regex(REPO_NAME).optional(),
    repos: z.array(repoEntrySchema),
  })
  .superRefine((list, context) => {
    const names = new Set<string>();
    const roots = new Set<string>();
    for (const repo of list.repos) {
      if (names.has(repo.name)) context.addIssue({ code: "custom", message: `the name ${repo.name} is listed twice` });
      if (roots.has(repo.root)) context.addIssue({ code: "custom", message: `${repo.root} is listed twice` });
      names.add(repo.name);
      roots.add(repo.root);
    }
    if (list.default !== undefined && !names.has(list.default)) context.addIssue({ code: "custom", message: `the default ${list.default} is not listed` });
  });

const ownerSchema = z.object({ schema: z.literal(1), root: z.string().min(1) });

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

export class NotListed extends TallyError {
  constructor(message: string) {
    super(message);
    this.name = "NotListed";
  }
}

export function unknownRepo(name: string, list: RepoList): NotListed {
  const listed = list.repos.map((repo) => repo.name).join(", ");
  return new NotListed(`no repository '${name}'; ${listed === "" ? "none is listed yet" : `listed: ${listed}`}`);
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
  if ((await gitIn(folder, ["rev-parse", "--git-dir"])) === null) throw new TallyError(`${folder} is not a git repository`);
  const root = await rootOfWorktree(folder);
  const top = await gitOut(folder, ["rev-parse", "--show-toplevel"]);
  if (top !== null && top !== folder) throw new TallyError(`${folder} is inside the repository ${top}; add that folder`);
  if (root !== folder) throw new TallyError(`${folder} is a linked worktree of ${root}; add that repository`);
  return folder;
}

async function stateOwner(home: string, name: string): Promise<string | undefined> {
  try {
    await access(ownerPath(home, name));
  } catch {
    return undefined;
  }
  return (await readJson(ownerPath(home, name), ownerSchema)).root;
}

function checkedName(name: string): string {
  if (!REPO_NAME.test(name)) throw new TallyError(`a repository's name is lowercase letters, digits, - and _, and starts with a letter or a digit: '${name}'`);
  return name;
}

export function readRepoList(home: string): Promise<RepoList> {
  return listFile(home).read();
}

async function free(home: string, list: RepoList, root: string, name: string): Promise<void> {
  const sameRoot = list.repos.find((repo) => repo.root === root);
  if (sameRoot !== undefined) throw new TallyError(`${root} is already listed as ${sameRoot.name}`);
  const sameName = list.repos.find((repo) => repo.name === name);
  if (sameName !== undefined) throw new TallyError(`the name ${name} is taken by ${sameName.root}`);
  const owner = await stateOwner(home, name);
  if (owner !== undefined && owner !== root) throw new TallyError(`the name ${name} still holds the state of ${owner}; pick another name`);
}

export async function addRepo(home: string, input: AddInput, now = new Date(), start?: (root: string) => Promise<unknown>): Promise<RepoEntry> {
  const root = await ownCheckout(input.root);
  const name = checkedName(input.name ?? nameFromFolder(root));
  const before = join(root, STATE_DIR);
  const open = (await listSessions({ stateDir: before })).length;
  if (open > 0) throw new TallyError(`${root} has ${open} open session${open === 1 ? "" : "s"} under ${before}; close ${open === 1 ? "it" : "them"} before listing the repository`);
  await free(home, await readRepoList(home), root, name);
  if (!(await hasConfig(root))) {
    if (start === undefined) throw new TallyError(`${root} has no ${RECORDS_DIR}/${CONFIG_FILE}`);
    await start(root);
  }
  await openRepo(root);
  const entry: RepoEntry = { name, root, addedAt: now.toISOString() };
  return listFile(home).update(async (list) => {
    await free(home, list, root, name);
    await writeJsonAtomic(ownerPath(home, name), { schema: 1, root });
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
