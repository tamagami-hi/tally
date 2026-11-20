import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterEach, describe, expect, test } from "vitest";
import { Hub } from "../src/hub.ts";
import { createServiceApp } from "../src/service.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked, type Tracked } from "../../core/tests/support/tracked.ts";

const hubs: Hub[] = [];

afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.stop();
});

interface Two {
  app: Hono;
  alpha: Tracked;
  beta: Tracked;
}

async function two(): Promise<Two> {
  const home = await tmpDir("tally-home-");
  const alpha = await makeTracked();
  const beta = await makeTracked();
  await addRepo(home, { root: alpha.root, name: "alpha" });
  await addRepo(home, { root: beta.root, name: "beta" });
  const web = await tmpDir("tally-web-");
  await mkdir(web, { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>tally</title>");
  const hub = new Hub(new Repos(home), { intervalMs: 50 });
  hubs.push(hub);
  return { app: createServiceApp({ hub, webDir: web, workspace: join(alpha.root, "..") }), alpha, beta };
}

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

async function rpc<T>(app: Hono, path: string, method: string, params: Record<string, unknown>): Promise<T> {
  const response = await app.request(path, { method: "POST", headers: HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return ((await response.json()) as { result: T }).result;
}

type Answer = { structuredContent?: Record<string, unknown>; content: { type: string; text: string }[]; isError?: boolean };

const call = (app: Hono, path: string, name: string, args: Record<string, unknown> = {}): Promise<Answer> => rpc<Answer>(app, path, "tools/call", { name, arguments: args });

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } };

describe("an MCP address for each repository", () => {
  test("reads that repository when a read names no session and no repository, with the answer's shape unchanged", async () => {
    const { app } = await two();

    const atBeta = await call(app, "/r/beta/mcp", "ledger_check");
    const atWhole = await call(app, "/mcp", "ledger_check");

    expect(atBeta.isError).not.toBe(true);
    expect(atBeta.structuredContent).not.toHaveProperty("repo");
    expect(atBeta.content.map((part) => part.text).join("\n")).not.toContain("the default repository");
    expect(atWhole.structuredContent).toHaveProperty("repo", "alpha");
  });

  test("refuses session_open for a folder of another repository, naming that repository's address", async () => {
    const { app, alpha, beta } = await two();

    const refused = await call(app, "/r/beta/mcp", "session_open", { worktree: alpha.trees["data"]!, agent: "claude" });
    const opened = await call(app, "/r/beta/mcp", "session_open", { worktree: beta.trees["data"]!, agent: "claude" });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("/r/alpha/mcp");
    expect(opened.isError).not.toBe(true);
  });

  test("names the repository in the server's instructions, and leaves /mcp's as they were", async () => {
    const { app } = await two();

    const atBeta = await rpc<{ instructions: string }>(app, "/r/beta/mcp", "initialize", INIT);
    const atWhole = await rpc<{ instructions: string }>(app, "/mcp", "initialize", INIT);

    expect(atBeta.instructions).toContain("beta");
    expect(atWhole.instructions).toMatch(/^tally tracks the builds of the repositories in its list; repo_list names them\./);
  });

  test("answers 404 for a repository that is not listed", async () => {
    const { app } = await two();

    const response = await app.request("/r/gamma/mcp", { method: "POST", headers: HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "no repository gamma is listed; repo_list names those that are" });
  });
});
