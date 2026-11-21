import { InMemoryServerEventBus, WebStandardStreamableHTTPServerTransport, createMcpHandler, isLegacyRequest, type McpServer } from "@modelcontextprotocol/server";
import { setTimeout as delay } from "node:timers/promises";
import { TallyError, commandsRunIn, type Repo, type Usage } from "@tally/core";
import { DECORATORS } from "./decorate.ts";
import type { Role } from "./roles.ts";
import { createAskServer } from "./ask.ts";
import { createTallyServer, type Revision } from "./server.ts";
import { isSource, oneRepo, type RepoSource } from "./source.ts";

export const MOST_BODY_BYTES = 4 * 1024 * 1024;

export const STOP_GRACE_MS = 5_000;

export interface Closing {
  graceMs?: number;
  handOver?: boolean;
}

export interface McpEndpoint {
  fetch: (request: Request) => Promise<Response>;
  close: (closing?: Closing) => Promise<string[]>;
  listening: () => number;
}

export class EndpointClosed extends TallyError {
  constructor() {
    super("this MCP handler is closed; the request goes to the one that serves the address now");
    this.name = "EndpointClosed";
  }
}

interface InFlight {
  done: Promise<unknown>;
  copy: Request | undefined;
}

type State = "open" | "handing over" | "stopping" | "closed";

async function described(flight: InFlight): Promise<string> {
  const text = await flight.copy?.text().catch(() => "");
  try {
    const message = JSON.parse(text ?? "") as { method?: unknown; params?: { name?: unknown } };
    return [message.method, message.params?.name].filter((part) => typeof part === "string").join(" ") || "a request";
  } catch {
    return "a request";
  }
}

async function settledWithin(waiting: readonly Promise<unknown>[], graceMs: number): Promise<boolean> {
  const timer = new AbortController();
  const settled = Promise.allSettled(waiting).then(() => true);
  const outlived = delay(graceMs, false, { signal: timer.signal }).catch(() => false);
  const result = await Promise.race([settled, outlived]);
  timer.abort();
  return result;
}

type Older = WebStandardStreamableHTTPServerTransport;

const logged = (error: Error): void => {
  process.stderr.write(`tally's MCP handler on 2026-07-28: ${error.message}\n`);
};

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
  const newer = createMcpHandler(() => build("modern"), { legacy: "reject", responseMode: "auto", bus, maxRequestBodySize: MOST_BODY_BYTES, onerror: logged });
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
  let state: State = "open";
  let inFlight: ReadonlySet<InFlight> = new Set();
  const serve = async (request: Request): Promise<Response> => {
    const legacy = await isLegacyRequest(request, undefined, { maxRequestBodySize: MOST_BODY_BYTES });
    if (state === "handing over") throw new EndpointClosed();
    return legacy ? older(request) : newer.fetch(request);
  };
  return {
    fetch: async (request) => {
      if (state !== "open") throw new EndpointClosed();
      const copy = request.method === "POST" ? request.clone() : undefined;
      const flight: InFlight = { done: serve(request), copy };
      inFlight = new Set([...inFlight, flight]);
      try {
        return await (flight.done as Promise<Response>);
      } finally {
        inFlight = new Set([...inFlight].filter((one) => one !== flight));
        void flight.copy?.body?.cancel().catch(() => undefined);
      }
    },
    close: async ({ graceMs = STOP_GRACE_MS, handOver = false }: Closing = {}) => {
      if (state !== "open") return [];
      state = handOver ? "handing over" : "stopping";
      const held = [...streams];
      streams = new Set();
      await Promise.all(held.map((transport) => transport.close()));
      const finished = await settledWithin([...inFlight].map((flight) => flight.done), graceMs);
      const left = finished ? [] : await Promise.all([...inFlight].map(described));
      await newer.close();
      state = "closed";
      return left;
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
