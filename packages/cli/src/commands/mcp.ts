import { Usage, usagePathOf, type Repo } from "@tally/core";
import { SERVER_VERSION, serveStdio, type RepoSource, type Streams } from "@tally/mcp";
import type { IO } from "../io.ts";
import type { UsagePlace } from "./usage.ts";

export async function mcpCommand(from: Repo | RepoSource, serving: string, io: IO, counted: UsagePlace, streams: Streams = { input: process.stdin, output: process.stdout }): Promise<number> {
  const usage = await Usage.open(usagePathOf(counted), SERVER_VERSION);
  usage.start();
  const server = await serveStdio(from, usage, streams);
  io.err(`tally MCP server for ${serving} on stdio`);
  await new Promise<void>((done) => {
    const close = (): void => void server.close();
    server.server.onclose = () => {
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      streams.input.off("end", close);
      done();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    streams.input.once("end", close);
  });
  await usage.stop();
  return 0;
}
