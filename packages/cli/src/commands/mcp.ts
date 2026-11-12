import type { Repo } from "@tally/core";
import { serveStdio, type RepoSource } from "@tally/mcp";
import type { IO } from "../io.ts";

export async function mcpCommand(from: Repo | RepoSource, serving: string, io: IO): Promise<number> {
  const server = await serveStdio(from);
  io.err(`tally MCP server for ${serving} on stdio`);
  await new Promise<void>((done) => {
    server.server.onclose = () => done();
    process.once("SIGINT", () => void server.close());
    process.once("SIGTERM", () => void server.close());
  });
  return 0;
}
