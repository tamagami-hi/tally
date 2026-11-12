import { homedir } from "node:os";
import { resolve } from "node:path";
import { TallyError, tallyHome, type Repo, type StartDefaults } from "@tally/core";
import { startServer, startService, type Running } from "@tally/server";
import { parse, text, type Parsed } from "../args.ts";
import type { IO } from "../io.ts";

export const DEFAULT_PORT = 47560;
export const DEFAULT_HOST = "127.0.0.1";

interface Listening {
  port: number;
  host: string;
  webDir?: string;
  intervalMs?: number;
}

function listening(parsed: Parsed, io: IO): Listening {
  const port = Number(text(parsed, "port") ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new TallyError(`--port must be a port number, not ${text(parsed, "port") ?? ""}`, 2);
  const webDir = text(parsed, "web-dir");
  const interval = text(parsed, "interval");
  return {
    port,
    host: text(parsed, "host") ?? DEFAULT_HOST,
    ...(webDir === undefined ? {} : { webDir: resolve(io.cwd, webDir) }),
    ...(interval === undefined ? {} : { intervalMs: Number(interval) }),
  };
}

export function serviceDefaults(env: NodeJS.ProcessEnv): StartDefaults {
  const name = env["TALLY_GIT_NAME"];
  const email = env["TALLY_GIT_EMAIL"];
  return name === undefined || name === "" || email === undefined || email === "" ? {} : { identity: { name, email } };
}

export function workspaceOf(given: string | undefined, io: IO): string {
  const named = given ?? io.env["TALLY_WORKSPACE"];
  return named === undefined || named === "" ? homedir() : resolve(io.cwd, named);
}

async function untilStopped(running: Running, io: IO): Promise<number> {
  await new Promise<void>((done) => {
    const stop = (): void => {
      void running.close().then(() => done());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  io.out("tally stopped");
  return 0;
}

const OPTIONS = { port: { type: "string" }, host: { type: "string" }, "web-dir": { type: "string" }, interval: { type: "string" }, workspace: { type: "string" } } as const;

export async function serveCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const running = await startServer({ repo, ...listening(parse(argv, OPTIONS), io) });
  io.out(`tally serves ${repo.config.name} at ${running.url}`);
  return untilStopped(running, io);
}

export async function serveListCommand(argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, OPTIONS);
  const workspace = workspaceOf(text(parsed, "workspace"), io);
  const running = await startService({ home: tallyHome(io.env), workspace, defaults: serviceDefaults(io.env), ...listening(parsed, io) });
  io.out(`tally serves every listed repository at ${running.url} (repositories are added from ${workspace})`);
  return untilStopped(running, io);
}
