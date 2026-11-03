import { resolve } from "node:path";
import { TallyError, type Repo } from "@tally/core";
import { startServer } from "@tally/server";
import { parse, text } from "../args.ts";
import type { IO } from "../io.ts";

export const DEFAULT_PORT = 47560;
export const DEFAULT_HOST = "127.0.0.1";

export async function serveCommand(repo: Repo, argv: readonly string[], io: IO): Promise<number> {
  const parsed = parse(argv, { port: { type: "string" }, host: { type: "string" }, "web-dir": { type: "string" }, interval: { type: "string" } });
  const port = Number(text(parsed, "port") ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new TallyError(`--port must be a port number, not ${text(parsed, "port") ?? ""}`, 2);
  const host = text(parsed, "host") ?? DEFAULT_HOST;
  const webDir = text(parsed, "web-dir");
  const interval = text(parsed, "interval");
  const running = await startServer({
    repo,
    port,
    host,
    ...(webDir === undefined ? {} : { webDir: resolve(io.cwd, webDir) }),
    ...(interval === undefined ? {} : { intervalMs: Number(interval) }),
  });
  io.out(`tally serves ${repo.config.name} at ${running.url}`);
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
