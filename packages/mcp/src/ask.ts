import { McpServer } from "@modelcontextprotocol/server";
import { TallyError } from "@tally/core";
import { DECORATORS, decorating } from "./decorate.ts";
import { listing } from "./listing.ts";
import { SERVER_NAME } from "./roles.ts";
import { SERVER_VERSION } from "./server-info.ts";
import type { Revision } from "./server.ts";
import type { RepoSource } from "./source.ts";
import { ASK_META, ASK_TRIAL, registerAskTrial, type Asking } from "./tools/ask-trial.ts";

export const ASK_ADDRESS = "/mcp/ask";

const ASK_INSTRUCTIONS = `tally serves one tool at ${ASK_ADDRESS}, ${ASK_TRIAL}: a trial that asks the person through this client's own dialog and answers what happened. It writes nothing; every other tool is at /mcp.`;

const NO_REPOSITORY = (): Promise<never> => Promise.reject(new TallyError(`${ASK_ADDRESS} reads no repository; its one tool is ${ASK_TRIAL}`));

const ASKS_NO_REPOSITORY: RepoSource = {
  instructions: ASK_INSTRUCTIONS,
  forSession: NO_REPOSITORY,
  forWorktree: NO_REPOSITORY,
  forRead: NO_REPOSITORY,
  isOneOfMany: async () => false,
  listed: async () => [],
};

export function createAskServer(revision: Revision, asking: Omit<Asking, "carries"> = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: ASK_INSTRUCTIONS });
  const tools = decorating(server, ASKS_NO_REPOSITORY, { decorators: DECORATORS, meta: (tool) => (tool === ASK_TRIAL ? ASK_META : undefined) });
  registerAskTrial(tools, { ...asking, carries: revision === "modern" });
  listing(server, tools.listed());
  server.server.registerCapabilities({ tools: { listChanged: revision === "modern" } });
  return server;
}
