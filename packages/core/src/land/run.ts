import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { gitMust } from "../git/run.ts";
import type { Landing, Track } from "../schema/config.ts";
import type { Repo } from "../store/records.ts";
import { LANDING_RETRIES, withLock } from "../store/lock.ts";
import { checkArguments, checkCheckout, checkTrackPaths, checkWorktree, type LandOptions } from "./checks.ts";
import { testCommits, undoCommit } from "./clean.ts";
import { fingerprint, statePath, trackOf, worktreeOf } from "./paths.ts";
import { spawnTests, type RunTests } from "./run-tests.ts";

export type { LandOptions } from "./checks.ts";
export { spawnTests } from "./run-tests.ts";

export interface LandDeps {
  runTests: RunTests;
  log: (line: string) => void;
  afterTests?: () => Promise<void>;
}

export interface Landed {
  track: string;
  head: string;
  commits: string[];
}

export const defaultDeps: LandDeps = { runTests: spawnTests, log: (line) => process.stdout.write(`${line}\n`) };

export async function landingEnvironment(repo: Repo, tree: string, track: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...repo.config.commands.env };
  for (const name of repo.config.commands.unset) delete env[name];
  if (repo.config.commands.tmpdir !== undefined) {
    const tmp = resolve(tree, repo.config.commands.tmpdir.replaceAll("{track}", track));
    await mkdir(tmp, { recursive: true });
    env["TMPDIR"] = tmp;
  }
  return env;
}

interface Attempt {
  repo: Repo;
  options: LandOptions;
  deps: LandDeps;
  track: Track;
  tree: string;
  main: string;
}

async function reuseVerification({ repo, deps, tree }: Attempt, verified: string): Promise<void> {
  if ((await fingerprint(tree, repo.config)) !== verified) throw new TallyError("track code differs from the verification; task preserved");
  deps.log(`reusing recorded verification of unchanged code ${verified}`);
}

async function commitNamedFiles({ repo, options, tree }: Attempt): Promise<void> {
  if (options.messageFile === undefined) return;
  const { name, email } = repo.config.identity;
  await gitMust(tree, ["add", "--", ...options.files]);
  await gitMust(tree, ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "--file", resolve(options.messageFile)]);
}

async function fastForward({ repo, main }: Attempt, target: string): Promise<void> {
  const { root, config } = repo;
  if ((await gitMust(root, ["rev-parse", config.mainBranch])) !== main) {
    throw new TallyError("main moved outside the landing lock; task preserved, retry");
  }
  await gitMust(root, ["merge", "--ff-only", target]);
}

async function landInWorktree(attempt: Attempt): Promise<void> {
  const { repo, options, deps, track, tree } = attempt;
  await gitMust(tree, ["diff", "--check"]);
  if (options.verifiedCode !== undefined) await reuseVerification(attempt, options.verifiedCode);
  else await deps.runTests(tree, track.test ?? repo.config.commands.test, await landingEnvironment(repo, tree, track.name));
  await commitNamedFiles(attempt);
  await deps.afterTests?.();
  await fastForward(attempt, track.branch);
}

async function testWhatLands(attempt: Attempt, landing: Landing, tip: string): Promise<void> {
  const { repo, deps, track, tree, main } = attempt;
  await testCommits({
    tree,
    track: track.name,
    range: `${main}..${tip}`,
    command: track.test ?? repo.config.commands.test,
    env: await landingEnvironment(repo, tree, track.name),
    landing,
    runTests: deps.runTests,
    log: deps.log,
  });
}

async function landTested(attempt: Attempt, landing: Landing): Promise<void> {
  const { options, deps, tree } = attempt;
  await gitMust(tree, ["diff", "--check", "--", ...options.files]);
  if (options.verifiedCode !== undefined) await reuseVerification(attempt, options.verifiedCode);
  const before = await gitMust(tree, ["rev-parse", "HEAD"]);
  await commitNamedFiles(attempt);
  const tip = await gitMust(tree, ["rev-parse", "HEAD"]);
  try {
    if (options.verifiedCode === undefined) await testWhatLands(attempt, landing, tip);
    await deps.afterTests?.();
    await fastForward(attempt, tip);
  } catch (error: unknown) {
    if (tip === before) throw error;
    throw new TallyError(`${messageOf(error)}; ${await undoCommit(tree, before, tip)}`);
  }
}

export async function landTrack(repo: Repo, options: LandOptions, deps: LandDeps = defaultDeps): Promise<Landed> {
  const { config, root } = repo;
  checkArguments(options, config);
  const track = trackOf(config, options.track);
  checkTrackPaths(track, options.files);
  const tree = worktreeOf(repo, track);
  return withLock(statePath(repo, "locks", "landing.lock"), async () => {
    await checkCheckout(repo);
    await checkWorktree(tree, track.branch, options, config);
    if (options.verifiedCode !== undefined && (await fingerprint(root, config)) !== options.verifiedCode) {
      throw new TallyError("main code differs from the verification; task preserved, recheck changed code");
    }
    const main = await gitMust(root, ["rev-parse", config.mainBranch]);
    await gitMust(tree, ["rebase", "--autostash", config.mainBranch]);
    const attempt: Attempt = { repo, options, deps, track, tree, main };
    const { landing } = config.commands;
    await (landing === undefined ? landInWorktree(attempt) : landTested(attempt, landing));
    const head = await gitMust(root, ["rev-parse", "--short=7", "HEAD"]);
    const commits = (await gitMust(root, ["log", "--reverse", "--format=%h", "--abbrev=7", `${main}..HEAD`])).split("\n").filter((line) => line !== "");
    deps.log(`${track.name} landed at ${head}`);
    return { track: track.name, head, commits };
  }, LANDING_RETRIES);
}

export function messagePath(repo: Repo, file: string): string {
  return resolve(repo.root, file);
}

export const landingLock = (repo: Repo): string => join(statePath(repo, "locks"), "landing.lock");
