import { execFile, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TallyError } from "../errors.ts";
import { safeName } from "../records/handoffs.ts";

const MAX_OUTPUT = 256 * 1024 * 1024;

export type RunTests = (cwd: string, command: readonly string[], env: NodeJS.ProcessEnv, label?: string) => Promise<void>;

async function passes(cwd: string, command: readonly string[], env: NodeJS.ProcessEnv, attach: (child: ChildProcess) => void): Promise<boolean> {
  const [program, ...args] = command;
  if (program === undefined) throw new TallyError("the config names no test command");
  return new Promise((done) => {
    attach(execFile(program, args, { cwd, env, maxBuffer: MAX_OUTPUT }, (error) => done(error === null)));
  });
}

function echoed(child: ChildProcess): void {
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
}

export async function spawnTests(cwd: string, command: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  if (!(await passes(cwd, command, env, echoed))) throw new TallyError(`${command.join(" ")} failed in ${cwd}`);
}

export function landingLog(tree: string, track: string, now = new Date()): string {
  return join(tree, ".temp", safeName(track), "tally", "landings", `${now.toISOString().replaceAll(/[:.]/g, "-")}.log`);
}

export function loggedTests(log: string, echo = false): RunTests {
  return async (cwd, command, env, label) => {
    await mkdir(dirname(log), { recursive: true });
    const file = createWriteStream(log, { flags: "a" });
    if (label !== undefined) file.write(`== ${label}\n`);
    const passed = await passes(cwd, command, env, (child) => {
      child.stdout?.pipe(file, { end: false });
      child.stderr?.pipe(file, { end: false });
      if (echo) echoed(child);
    });
    await new Promise<void>((done) => file.end(done));
    if (!passed) throw new TallyError(`${command.join(" ")} failed in ${cwd}; the log is ${log}`);
  };
}
