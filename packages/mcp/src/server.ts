import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { TallyError, commandsRunIn, type CommandPlace, type Repo, type Usage } from "@tally/core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { registerCheckTools } from "./tools/checks.ts";
import { registerCommandTools } from "./tools/commands.ts";
import { registerContextTools } from "./tools/context.ts";
import { registerDeferredTools } from "./tools/deferred.ts";
import { registerDocTools } from "./tools/docs.ts";
import { registerLandTools } from "./tools/land.ts";
import { registerNoteTools } from "./tools/notes.ts";
import { registerLedgerTools } from "./tools/ledger.ts";
import { registerMilestoneTools } from "./tools/milestones.ts";
import { registerCycleTools } from "./tools/cycles.ts";
import { registerPhaseTools } from "./tools/phases.ts";
import { registerRulebookTools } from "./tools/rulebook.ts";
import { registerQuestionTools } from "./tools/questions.ts";
import { registerRecordTools } from "./tools/records.ts";
import { registerReviewTools } from "./tools/reviews.ts";
import { registerSessionTools } from "./tools/session.ts";
import { registerTrackTools } from "./tools/tracks.ts";
import { DECORATORS, decorating, type Decorated, type Decorator } from "./decorate.ts";
import { listEntry, listing } from "./listing.ts";
import { usageRanking, type Ranking } from "./usage.ts";
import { isSource, oneRepo, type RepoSource } from "./source.ts";
import { SERVER_VERSION } from "./server-info.ts";

export const SERVER_NAME = "tally";
export { SERVER_VERSION } from "./server-info.ts";

export function createTallyServer(from: Repo | RepoSource, decorators: readonly Decorator[] = DECORATORS, place: CommandPlace = commandsRunIn(), usage?: Usage): McpServer {
  const source = isSource(from) ? from : oneRepo(from);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: source.instructions });
  const tools = decorating(server, source, { decorators, place, usage });
  registerAll(tools, source, place);
  listing(server, tools.listed());
  server.server.registerCapabilities({ tools: { listChanged: false } });
  return server;
}

function registerAll(tools: Decorated, source: RepoSource, place: CommandPlace): void {
  registerSessionTools(tools, source, place);
  registerLedgerTools(tools, source);
  registerMilestoneTools(tools, source);
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
  registerCycleTools(tools, source);
}

export async function serveStdio(from: Repo | RepoSource, usage?: Usage): Promise<McpServer> {
  const server = createTallyServer(from, DECORATORS, commandsRunIn(), usage);
  await server.connect(new StdioServerTransport());
  return server;
}

export function mcpHandler(from: Repo | RepoSource, usage?: Usage): (request: Request) => Promise<Response> {
  const source = isSource(from) ? from : oneRepo(from);
  const place = commandsRunIn();
  return async (request) => {
    const server = createTallyServer(source, DECORATORS, place, usage);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}

const LISTING_ONLY: RepoSource = {
  instructions: "",
  forSession: () => Promise.reject(new TallyError("this server only lists its tools")),
  forWorktree: () => Promise.reject(new TallyError("this server only lists its tools")),
  forRead: () => Promise.reject(new TallyError("this server only lists its tools")),
  isOneOfMany: async () => false,
  listed: async () => [],
};

export const usageNow = (usage: Usage | undefined, place: CommandPlace = commandsRunIn()): Ranking => usageRanking(usage?.snapshot() ?? { schema: 1, since: new Date().toISOString(), versions: [], tools: {} }, listedEntries(place));

export function listedEntries(place: CommandPlace): Tool[] {
  const tools = decorating(new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }), LISTING_ONLY, { place });
  registerAll(tools, LISTING_ONLY, place);
  return tools.listed().map(listEntry);
}
