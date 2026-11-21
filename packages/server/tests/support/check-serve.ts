import { appendFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { TallyError } from "@tally/core";
import { Endpoints } from "../../src/endpoints.ts";
import { Hub } from "../../src/hub.ts";
import { defaultWebDir } from "../../src/serve.ts";
import { createServiceApp } from "../../src/service.ts";
import { addRepo } from "../../../core/src/repos/list.ts";
import { Repos } from "../../../core/src/repos/repos.ts";
import { tmpDir } from "../../../core/tests/support/tmp.ts";
import { makeTracked } from "../../../core/tests/support/tracked.ts";

const SERVICE_PORT = 47560;
const LOWEST_PORT = 1024;
const HIGHEST_PORT = 65535;
const MCP_PATH = /\/mcp(\/|$)/;
const OLDER = "2025 (no revision named)";

export function checkPort(value: string): number {
  const port = Number(value);
  if (port === SERVICE_PORT) throw new TallyError(`the check never serves on ${SERVICE_PORT}, the operator's service's port; pick another`);
  if (!Number.isInteger(port) || port < LOWEST_PORT || port > HIGHEST_PORT) throw new TallyError(`CHECK_PORT must be a port number from ${LOWEST_PORT} to ${HIGHEST_PORT}, not ${value}`);
  return port;
}

interface Sent {
  method?: unknown;
  params?: { protocolVersion?: unknown; _meta?: Record<string, unknown> };
}

function revisionOf(request: Request, sent: Sent): string {
  const named = request.headers.get("mcp-protocol-version") ?? sent.params?._meta?.["io.modelcontextprotocol/protocolVersion"] ?? sent.params?.protocolVersion;
  return typeof named === "string" ? named : OLDER;
}

async function sentOf(request: Request): Promise<Sent> {
  if (request.method !== "POST") return {};
  return (await request.clone().json().catch(() => ({}))) as Sent;
}

export interface Checking {
  url: string;
  close: () => Promise<void>;
}

export async function serveForCheck(port: number, out: string): Promise<Checking> {
  const home = await tmpDir("tally-check-home-");
  for (const name of ["alpha", "beta"]) await addRepo(home, { root: (await makeTracked()).root, name });
  const hub = new Hub(new Repos(home));
  const endpoints = new Endpoints();
  const app = createServiceApp({ hub, webDir: defaultWebDir(), workspace: home, endpoints });
  const logged = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (!MCP_PATH.test(path)) return app.fetch(request);
    const sent = await sentOf(request);
    const answer = await app.fetch(request);
    const line = { at: new Date().toISOString(), path, http: request.method, method: sent.method ?? null, revision: revisionOf(request, sent), status: answer.status };
    await appendFile(out, `${JSON.stringify(line)}\n`);
    return answer;
  };
  hub.start();
  const server = serve({ fetch: logged, port, hostname: "127.0.0.1" });
  await new Promise<void>((started) => server.once("listening", () => started()));
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await endpoints.close();
      await hub.stop();
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}
