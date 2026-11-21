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

const EVENT_STREAM = "text/event-stream";

const isEventStream = (answer: Response): boolean => (answer.headers.get("content-type") ?? "").startsWith(EVENT_STREAM);

function watched(body: ReadableStream<Uint8Array>, ended: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read().catch((error: unknown) => {
        ended();
        throw error;
      });
      if (!chunk.done) return controller.enqueue(chunk.value);
      ended();
      return controller.close();
    },
    async cancel(reason) {
      ended();
      await reader.cancel(reason);
    },
  });
}

export function endpointFor(build: (revision: Revision) => McpServer): McpEndpoint {
  const bus = new InMemoryServerEventBus();
  const newer = createMcpHandler(() => build("modern"), { legacy: "reject", responseMode: "json", bus, maxRequestBodySize: MOST_BODY_BYTES });
  let streams: ReadonlySet<Older> = new Set();
  const letGo = (transport: Older): void => {
    streams = new Set([...streams].filter((held) => held !== transport));
  };
  const holding = (transport: Older, request: Request, answer: Response): Response => {
    if (answer.body === null || !isEventStream(answer)) return answer;
    streams = new Set([...streams, transport]);
    request.signal.addEventListener("abort", () => letGo(transport), { once: true });
    return new Response(watched(answer.body, () => letGo(transport)), { status: answer.status, statusText: answer.statusText, headers: answer.headers });
  };
  const older = async (request: Request): Promise<Response> => {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: MOST_BODY_BYTES });
    await build("legacy").connect(transport);
    const answer = await transport.handleRequest(request);
    return request.method === "GET" ? holding(transport, request, answer) : answer;
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
