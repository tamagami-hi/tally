import { execFile } from "node:child_process";
import { TallyError } from "../errors.ts";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<GitResult> {
  return new Promise((done) => {
    execFile("git", [...args], { cwd, env: { GIT_OPTIONAL_LOCKS: "0", ...(env ?? process.env) }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
      done({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export async function gitOut(cwd: string, args: readonly string[]): Promise<string | null> {
  const result = await git(cwd, args);
  return result.code === 0 ? result.stdout.replace(/\n$/, "") : null;
}

export async function gitMust(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await git(cwd, args, env);
  if (result.code !== 0) {
    throw new TallyError(`git ${args.join(" ")} failed in ${cwd}:\n${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.replace(/\n$/, "");
}
