import { execFile } from "node:child_process";
import { TallyError } from "../errors.ts";

const SAFE: readonly string[] = ["-c", "core.fsmonitor=false"];

export const OWN_COMMIT: readonly string[] = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"];

export const asIdentity = (identity: { name: string; email: string }): string[] => [...OWN_COMMIT, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`];

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const GIT_LIMIT_MS = 60_000;
export const GIT_LONG_LIMIT_MS = 300_000;
export const GIT_TIMED_OUT = 124;

const MS_PER_SECOND = 1000;
const MAX_OUTPUT = 64 * 1024 * 1024;
const LONG_VERBS: ReadonlySet<string> = new Set(["worktree", "rebase", "checkout", "clean", "cherry-pick", "reset"]);

function verbOf(args: readonly string[]): string | undefined {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? "";
    if (arg === "-c" || arg === "-C") at += 1;
    else if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

export const limitOf = (args: readonly string[]): number => (LONG_VERBS.has(verbOf(args) ?? "") ? GIT_LONG_LIMIT_MS : GIT_LIMIT_MS);

const stoppedLine = (args: readonly string[], limitMs: number): string => `git ${verbOf(args) ?? ""} did not end within ${limitMs / MS_PER_SECOND} s and was stopped`;

export function git(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv, limitMs = limitOf(args)): Promise<GitResult> {
  return new Promise((done) => {
    execFile("git", [...SAFE, ...args], { cwd, env: { GIT_OPTIONAL_LOCKS: "0", ...(env ?? process.env) }, maxBuffer: MAX_OUTPUT, timeout: limitMs }, (error, stdout, stderr) => {
      if (error !== null && error.killed === true && error.signal !== null) {
        done({ code: GIT_TIMED_OUT, stdout: String(stdout), stderr: `${String(stderr)}${stoppedLine(args, limitMs)}` });
        return;
      }
      const code = error === null ? 0 : typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
      done({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export async function gitOut(cwd: string, args: readonly string[]): Promise<string | null> {
  const result = await git(cwd, args);
  return result.code === 0 ? result.stdout.replace(/\n$/, "") : null;
}

export async function gitMust(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv, limitMs?: number): Promise<string> {
  const result = await git(cwd, args, env, limitMs);
  if (result.code !== 0) {
    throw new TallyError(`git ${args.join(" ")} failed in ${cwd}:\n${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.replace(/\n$/, "");
}
