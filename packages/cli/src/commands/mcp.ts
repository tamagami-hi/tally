import { Usage, usagePathOf, type Repo } from "@tally/core";
import { SERVER_VERSION, serveStdio, type RepoSource } from "@tally/mcp";
import type { IO } from "../io.ts";
import type { UsagePlace } from "./usage.ts";

export async function mcpCommand(from: Repo | RepoSource, serving: string, io: IO, counted: UsagePlace): Promise<number> {
  const usage = await Usage.open(usagePathOf(counted), SERVER_VERSION);
  usage.start();
  const server = await serveStdio(from, usage);
  io.err(`tally MCP server for ${serving} on stdio`);
  await new Promise<void>((done) => {
    server.server.onclose = () => done();
    process.once("SIGINT", () => void server.close());
    process.once("SIGTERM", () => void server.close());
  });
  await usage.stop();
  return 0;
}
