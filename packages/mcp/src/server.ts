import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Repo } from "@tally/core";
import { registerCheckTools } from "./tools/checks.ts";
import { registerDocTools } from "./tools/docs.ts";
import { registerLedgerTools } from "./tools/ledger.ts";
import { registerRecordTools } from "./tools/records.ts";
import { registerSessionTools } from "./tools/session.ts";

export const SERVER_NAME = "tally";
export const SERVER_VERSION = "0.1.0";

export function createTallyServer(repo: Repo): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: `tally tracks the build of ${repo.config.name}. Open a session with session_open (your worktree and track) before any writing tool; read context_pack at your level first. Records change only through these tools; main is never pushed from here.` });
  registerSessionTools(server, repo);
  registerLedgerTools(server, repo);
  registerRecordTools(server, repo);
  registerDocTools(server, repo);
  registerCheckTools(server, repo);
  return server;
}

export async function serveStdio(repo: Repo): Promise<McpServer> {
  const server = createTallyServer(repo);
  await server.connect(new StdioServerTransport());
  return server;
}

export function mcpHandler(repo: Repo): (request: Request) => Promise<Response> {
  return async (request) => {
    const server = createTallyServer(repo);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
