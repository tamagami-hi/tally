import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { commandsRunIn, type CommandPlace, type Repo } from "@tally/core";
import { registerCheckTools } from "./tools/checks.ts";
import { registerCommandTools } from "./tools/commands.ts";
import { registerContextTools } from "./tools/context.ts";
import { registerDeferredTools } from "./tools/deferred.ts";
import { registerDocTools } from "./tools/docs.ts";
import { registerLandTools } from "./tools/land.ts";
import { registerNoteTools } from "./tools/notes.ts";
import { registerLedgerTools } from "./tools/ledger.ts";
import { registerPhaseTools } from "./tools/phases.ts";
import { registerRulebookTools } from "./tools/rulebook.ts";
import { registerQuestionTools } from "./tools/questions.ts";
import { registerRecordTools } from "./tools/records.ts";
import { registerReviewTools } from "./tools/reviews.ts";
import { registerSessionTools } from "./tools/session.ts";
import { registerTrackTools } from "./tools/tracks.ts";
import { DECORATORS, decorating, type Decorator } from "./decorate.ts";
import { isSource, oneRepo, type RepoSource } from "./source.ts";

export const SERVER_NAME = "tally";
export const SERVER_VERSION = "0.1.0";

export function createTallyServer(from: Repo | RepoSource, decorators: readonly Decorator[] = DECORATORS, place: CommandPlace = commandsRunIn()): McpServer {
  const source = isSource(from) ? from : oneRepo(from);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: source.instructions });
  const tools = decorating(server, source, decorators, place);
  registerSessionTools(tools, source);
  registerLedgerTools(tools, source);
  registerDeferredTools(tools, source);
  registerReviewTools(tools, source);
  registerRecordTools(tools, source);
  registerCommandTools(tools, source, place);
  registerLandTools(tools, source);
  registerNoteTools(tools, source);
  registerDocTools(tools, source);
  registerQuestionTools(tools, source);
  registerCheckTools(tools, source);
  registerTrackTools(tools, source);
  registerContextTools(tools, source);
  registerRulebookTools(tools, source);
  registerPhaseTools(tools, source);
  return server;
}

export async function serveStdio(from: Repo | RepoSource): Promise<McpServer> {
  const server = createTallyServer(from, DECORATORS, commandsRunIn());
  await server.connect(new StdioServerTransport());
  return server;
}

export function mcpHandler(from: Repo | RepoSource): (request: Request) => Promise<Response> {
  const source = isSource(from) ? from : oneRepo(from);
  const place = commandsRunIn();
  return async (request) => {
    const server = createTallyServer(source, DECORATORS, place);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
