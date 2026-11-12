import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Repo } from "@tally/core";
import { registerCheckTools } from "./tools/checks.ts";
import { registerContextTools } from "./tools/context.ts";
import { registerDocTools } from "./tools/docs.ts";
import { registerLandTools } from "./tools/land.ts";
import { registerLedgerTools } from "./tools/ledger.ts";
import { registerRecordTools } from "./tools/records.ts";
import { registerSessionTools } from "./tools/session.ts";
import { DECORATORS, decorating, type Decorator } from "./decorate.ts";
import { isSource, oneRepo, type RepoSource } from "./source.ts";

export const SERVER_NAME = "tally";
export const SERVER_VERSION = "0.1.0";

export function createTallyServer(from: Repo | RepoSource, decorators: readonly Decorator[] = DECORATORS): McpServer {
  const source = isSource(from) ? from : oneRepo(from);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: source.instructions });
  const tools = decorating(server, source, decorators);
  registerSessionTools(tools, source);
  registerLedgerTools(tools, source);
  registerRecordTools(tools, source);
  registerLandTools(tools, source);
  registerDocTools(tools, source);
  registerCheckTools(tools, source);
  registerContextTools(tools, source);
  return server;
}

export async function serveStdio(from: Repo | RepoSource): Promise<McpServer> {
  const server = createTallyServer(from);
  await server.connect(new StdioServerTransport());
  return server;
}

export function mcpHandler(from: Repo | RepoSource): (request: Request) => Promise<Response> {
  return async (request) => {
    const server = createTallyServer(from);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
