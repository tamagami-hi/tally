import { InMemoryServerEventBus, WebStandardStreamableHTTPServerTransport, createMcpHandler, isLegacyRequest, type McpServer } from "@modelcontextprotocol/server";
import { commandsRunIn, type Repo, type Usage } from "@tally/core";
import { DECORATORS } from "./decorate.ts";
import type { Role } from "./roles.ts";
import { createTallyServer } from "./server.ts";
import { isSource, oneRepo, type RepoSource } from "./source.ts";

export const MOST_BODY_BYTES = 4 * 1024 * 1024;

export interface McpEndpoint {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
  listening: () => number;
}

export interface EndpointTimings {
  keepAliveMs?: number;
}

export function mcpEndpoint(from: Repo | RepoSource, usage?: Usage, role?: Role, timings: EndpointTimings = {}): McpEndpoint {
  const source = isSource(from) ? from : oneRepo(from);
  const place = commandsRunIn();
  const build = (): McpServer => createTallyServer(source, DECORATORS, place, usage, role);
  const bus = new InMemoryServerEventBus();
  const newer = createMcpHandler(build, { legacy: "reject", responseMode: "json", bus, maxRequestBodySize: MOST_BODY_BYTES, ...timings });
  return {
    fetch: async (request) => ((await isLegacyRequest(request, undefined, { maxRequestBodySize: MOST_BODY_BYTES })) ? answerInJson(build(), request) : newer.fetch(request)),
    close: () => newer.close(),
    listening: () => bus.listenerCount,
  };
}

async function answerInJson(server: McpServer, request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: MOST_BODY_BYTES });
  await server.connect(transport);
  return transport.handleRequest(request);
}
