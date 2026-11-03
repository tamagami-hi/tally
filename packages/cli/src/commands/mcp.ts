import type { Repo } from "@tally/core";
import { serveStdio } from "@tally/mcp";
import type { IO } from "../io.ts";

export async function mcpCommand(repo: Repo, io: IO): Promise<number> {
  const server = await serveStdio(repo);
  io.err(`tally MCP server for ${repo.config.name} on stdio`);
  await new Promise<void>((done) => {
    server.server.onclose = () => done();
    process.once("SIGINT", () => void server.close());
    process.once("SIGTERM", () => void server.close());
  });
  return 0;
}
