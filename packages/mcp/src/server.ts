import { StdioServerTransport, serveStdio as serveOnStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import type { Tool } from "@modelcontextprotocol/server";
import { TallyError, commandsRunIn, type CommandPlace, type Repo, type Usage } from "@tally/core";
import type { Readable, Writable } from "node:stream";
import { registerCheckTools } from "./tools/checks.ts";
import { registerCommandTools } from "./tools/commands.ts";
import { registerContextTools } from "./tools/context.ts";
import { registerDeferredTools } from "./tools/deferred.ts";
import { registerDecisionTools } from "./tools/decisions.ts";
import { registerDocTools } from "./tools/docs.ts";
import { registerLandTools } from "./tools/land.ts";
import { registerNoteTools } from "./tools/notes.ts";
import { registerLedgerTools } from "./tools/ledger.ts";
import { registerMilestoneTools } from "./tools/milestones.ts";
import { registerCoveringTools } from "./tools/covering.ts";
import { registerCycleTools } from "./tools/cycles.ts";
import { registerPhaseTools } from "./tools/phases.ts";
import { registerRulebookTools } from "./tools/rulebook.ts";
import { registerQuestionTools } from "./tools/questions.ts";
import { registerRecordTools } from "./tools/records.ts";
import { registerReleaseTools } from "./tools/releases.ts";
import { registerTrialTools } from "./tools/trials.ts";
import { registerReviewTools } from "./tools/reviews.ts";
import { registerSessionTools } from "./tools/session.ts";
import { registerTrackTools } from "./tools/tracks.ts";
import { DECORATORS, decorating, type Decorated, type Decorator } from "./decorate.ts";
import { listEntry, listing } from "./listing.ts";
import { usageRanking, type Ranking } from "./usage.ts";
import { isSource, oneRepo, type RepoSource } from "./source.ts";
import { SERVER_VERSION } from "./server-info.ts";
import { ROLE_PROTOCOL, SERVER_NAME, type Role } from "./roles.ts";

export { SERVER_NAME } from "./roles.ts";
export { SERVER_VERSION } from "./server-info.ts";

export type Revision = "legacy" | "modern";

export function createTallyServer(from: Repo | RepoSource, decorators: readonly Decorator[] = DECORATORS, place: CommandPlace = commandsRunIn(), usage?: Usage, role?: Role, revision: Revision = "legacy"): McpServer {
  const source = isSource(from) ? from : oneRepo(from);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: role === undefined ? source.instructions : ROLE_PROTOCOL[role] });
  const tools = decorating(server, source, { decorators, place, usage, ...(role === undefined ? {} : { role }) });
  registerAll(tools, source, place, role);
  listing(server, tools.listed());
  server.server.registerCapabilities({ tools: { listChanged: revision === "modern" } });
  return server;
}

function registerAll(tools: Decorated, source: RepoSource, place: CommandPlace, role?: Role): void {
  registerSessionTools(tools, source, place, role);
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
  registerDecisionTools(tools, source);
  registerCoveringTools(tools, source);
  registerCheckTools(tools, source);
  registerTrackTools(tools, source);
  registerContextTools(tools, source);
  registerRulebookTools(tools, source);
  registerPhaseTools(tools, source);
  registerCycleTools(tools, source);
  registerReleaseTools(tools, source);
  registerTrialTools(tools, source);
}

export interface Streams {
  input: Readable;
  output: Writable;
}

export interface StdioServing {
  close: () => Promise<void>;
}

export function serveStdio(from: Repo | RepoSource, usage?: Usage, streams?: Streams): StdioServing {
  const source = isSource(from) ? from : oneRepo(from);
  const place = commandsRunIn();
  return serveOnStdio((opened) => createTallyServer(source, DECORATORS, place, usage, undefined, opened.era), { transport: new StdioServerTransport(streams?.input, streams?.output) });
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
