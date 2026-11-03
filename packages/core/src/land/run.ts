import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TallyError } from "../errors.ts";
import { gitMust } from "../git/run.ts";
import type { Repo } from "../store/records.ts";
import { withLock } from "../store/lock.ts";
import { checkArguments, checkCheckout, checkWorktree, type LandOptions } from "./checks.ts";
import { fingerprint, statePath, trackOf, worktreeOf } from "./paths.ts";

export type { LandOptions } from "./checks.ts";

export interface LandDeps {
  runTests: (cwd: string, command: readonly string[], env: NodeJS.ProcessEnv) => Promise<void>;
  log: (line: string) => void;
  afterTests?: () => Promise<void>;
}

export interface Landed {
  track: string;
  head: string;
}

export function spawnTests(cwd: string, command: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  const [program, ...args] = command;
  if (program === undefined) throw new TallyError("the config names no test command");
  return new Promise((done, fail) => {
    const child = execFile(program, args, { cwd, env, maxBuffer: 256 * 1024 * 1024 }, (error) => {
      if (error === null) done();
      else fail(new TallyError(`${command.join(" ")} failed in ${cwd}`));
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

export const defaultDeps: LandDeps = { runTests: spawnTests, log: (line) => process.stdout.write(`${line}\n`) };

async function environment(repo: Repo, tree: string, track: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...repo.config.commands.env };
  for (const name of repo.config.commands.unset) delete env[name];
  if (repo.config.commands.tmpdir !== undefined) {
    const tmp = resolve(tree, repo.config.commands.tmpdir.replaceAll("{track}", track));
    await mkdir(tmp, { recursive: true });
    env["TMPDIR"] = tmp;
  }
  return env;
}

export async function landTrack(repo: Repo, options: LandOptions, deps: LandDeps = defaultDeps): Promise<Landed> {
  const { config, root } = repo;
  checkArguments(options, config);
  const track = trackOf(config, options.track);
  const tree = worktreeOf(repo, track);
  return withLock(statePath(repo, "locks", "landing.lock"), async () => {
    await checkCheckout(repo);
    await checkWorktree(tree, track.branch, options, config);
    if (options.verifiedCode !== undefined && (await fingerprint(root, config)) !== options.verifiedCode) {
      throw new TallyError("main code differs from the verification; task preserved, recheck changed code");
    }
    const main = await gitMust(root, ["rev-parse", config.mainBranch]);
    await gitMust(tree, ["rebase", "--autostash", config.mainBranch]);
    await gitMust(tree, ["diff", "--check"]);
    if (options.verifiedCode !== undefined) {
      if ((await fingerprint(tree, config)) !== options.verifiedCode) throw new TallyError("track code differs from the verification; task preserved");
      deps.log(`reusing recorded verification of unchanged code ${options.verifiedCode}`);
    } else {
      await deps.runTests(tree, config.commands.test, await environment(repo, tree, track.name));
    }
    if (options.messageFile !== undefined) {
      await gitMust(tree, ["add", "--", ...options.files]);
      const identity = ["-c", `user.name=${config.identity.name}`, "-c", `user.email=${config.identity.email}`];
      await gitMust(tree, [...identity, "commit", "--file", resolve(options.messageFile)]);
    }
    await deps.afterTests?.();
    if ((await gitMust(root, ["rev-parse", config.mainBranch])) !== main) {
      throw new TallyError("main moved outside the landing lock; task preserved, retry");
    }
    await gitMust(root, ["merge", "--ff-only", track.branch]);
    const head = await gitMust(root, ["rev-parse", "--short=7", "HEAD"]);
    deps.log(`${track.name} landed at ${head}`);
    return { track: track.name, head };
  });
}

export function messagePath(repo: Repo, file: string): string {
  return resolve(repo.root, file);
}

export const landingLock = (repo: Repo): string => join(statePath(repo, "locks"), "landing.lock");
