import { InMemoryServerEventBus, WebStandardStreamableHTTPServerTransport, createMcpHandler, isLegacyRequest, type McpServer } from "@modelcontextprotocol/server";
import { commandsRunIn, type Repo, type Usage } from "@tally/core";
import { DECORATORS } from "./decorate.ts";
import type { Role } from "./roles.ts";
import { createAskServer } from "./ask.ts";
import { createTallyServer, type Revision } from "./server.ts";
import { isSource, oneRepo, type RepoSource } from "./source.ts";

export const MOST_BODY_BYTES = 4 * 1024 * 1024;

export interface McpEndpoint {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
  listening: () => number;
}

type Older = WebStandardStreamableHTTPServerTransport;

export function endpointFor(build: (revision: Revision) => McpServer): McpEndpoint {
  const bus = new InMemoryServerEventBus();
  const newer = createMcpHandler(() => build("modern"), { legacy: "reject", responseMode: "json", bus, maxRequestBodySize: MOST_BODY_BYTES });
  let streams: ReadonlySet<Older> = new Set();
  const letGo = (transport: Older): void => {
    streams = new Set([...streams].filter((held) => held !== transport));
  };
  const older = async (request: Request): Promise<Response> => {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: MOST_BODY_BYTES });
    await build("legacy").connect(transport);
    if (request.method === "GET") {
      streams = new Set([...streams, transport]);
      request.signal.addEventListener("abort", () => letGo(transport), { once: true });
    }
    return transport.handleRequest(request);
  };
  return {
    fetch: async (request) => ((await isLegacyRequest(request, undefined, { maxRequestBodySize: MOST_BODY_BYTES })) ? older(request) : newer.fetch(request)),
    close: async () => {
      const held = [...streams];
      streams = new Set();
      await Promise.all([newer.close(), ...held.map((transport) => transport.close())]);
    },
    listening: () => bus.listenerCount + streams.size,
  };
}

export function mcpEndpoint(from: Repo | RepoSource, usage?: Usage, role?: Role): McpEndpoint {
  const source = isSource(from) ? from : oneRepo(from);
  const place = commandsRunIn();
  return endpointFor(() => createTallyServer(source, DECORATORS, place, usage, role));
}

export const askEndpoint = (): McpEndpoint => endpointFor((revision) => createAskServer(revision));
