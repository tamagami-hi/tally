import { Usage, usagePathOf, type Repo } from "@tally/core";
import { SERVER_VERSION, serveStdio, type RepoSource, type Streams } from "@tally/mcp";
import type { IO } from "../io.ts";
import type { UsagePlace } from "./usage.ts";

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

function untilEnded(streams: Streams): Promise<void> {
  return new Promise((done) => {
    const end = (): void => {
      for (const signal of SIGNALS) process.off(signal, end);
      streams.input.off("end", end);
      streams.output.off("close", end);
      streams.output.off("error", end);
      done();
    };
    for (const signal of SIGNALS) process.once(signal, end);
    streams.input.once("end", end);
    streams.output.once("close", end);
    streams.output.once("error", end);
  });
}

export async function mcpCommand(from: Repo | RepoSource, serving: string, io: IO, counted: UsagePlace, streams: Streams = { input: process.stdin, output: process.stdout }): Promise<number> {
  const usage = await Usage.open(usagePathOf(counted), SERVER_VERSION);
  usage.start();
  const server = serveStdio(from, usage, streams);
  io.err(`tally MCP server for ${serving} on stdio`);
  await untilEnded(streams);
  await server.close();
  await usage.stop();
  return 0;
}
