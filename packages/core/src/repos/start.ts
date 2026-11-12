import { access, appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { TallyError } from "../errors.ts";
import { asIdentity, git, gitMust, gitOut } from "../git/run.ts";
import { configSchema } from "../schema/config.ts";
import { RECORDS_DIR, initRecords, type Repo } from "../store/records.ts";

export interface StartDefaults {
  identity?: { name: string; email: string };
}

export const NO_CHECK = ["sh", "-c", "echo 'no check is set for this repository yet; set one with repo_configure' >&2; exit 1"];
export const START_MESSAGE = "records: start tracking";

const TEMP = ".temp/";
const DETECTED: readonly (readonly [file: string, command: readonly string[]])[] = [
  ["package.json", ["npm", "test"]],
  ["Cargo.toml", ["cargo", "test"]],
  ["pyproject.toml", ["pytest"]],
  ["go.mod", ["go", "test", "./..."]],
];

async function present(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectedCheck(root: string): Promise<readonly string[]> {
  for (const [file, command] of DETECTED) {
    if (await present(join(root, file))) return command;
  }
  return NO_CHECK;
}

async function identityOf(root: string, defaults: StartDefaults): Promise<{ name: string; email: string }> {
  const name = (await gitOut(root, ["config", "user.name"])) ?? defaults.identity?.name ?? "";
  const email = (await gitOut(root, ["config", "user.email"])) ?? defaults.identity?.email ?? "";
  if (name === "" || email === "") throw new TallyError(`${root} has no git user.name and user.email, and the service has no default identity (TALLY_GIT_NAME, TALLY_GIT_EMAIL)`);
  return { name, email };
}

async function ignoreTemp(root: string): Promise<void> {
  if ((await git(root, ["check-ignore", "-q", `${TEMP}probe`])).code === 0) return;
  const common = await gitMust(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  await mkdir(join(common, "info"), { recursive: true });
  await appendFile(join(common, "info", "exclude"), `${TEMP}\n`);
}

export async function startRecords(root: string, defaults: StartDefaults = {}): Promise<Repo> {
  const baseline = await gitOut(root, ["rev-parse", "--short=7", "HEAD"]);
  if (baseline === null) throw new TallyError(`${root} has no commit yet; make its first commit, then add it`);
  const mainBranch = await gitMust(root, ["branch", "--show-current"]);
  if (mainBranch === "") throw new TallyError(`${root} is on no branch; check out its main branch, then add it`);
  const identity = await identityOf(root, defaults);
  const config = configSchema.parse({
    schema: 1,
    name: basename(root),
    mainBranch,
    tracks: [],
    stages: [{ id: "build", name: "the build", weight: 100 }],
    commands: { test: await detectedCheck(root) },
    fingerprint: { paths: ["."], exclude: [RECORDS_DIR] },
    identity,
  });
  await ignoreTemp(root);
  const repo = await initRecords(root, config, baseline);
  await gitMust(root, ["add", "--", RECORDS_DIR]);
  await gitMust(root, [...asIdentity(identity), "commit", "-q", "-m", START_MESSAGE, "--", RECORDS_DIR]);
  return repo;
}
