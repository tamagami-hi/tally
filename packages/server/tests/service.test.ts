import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterEach, describe, expect, test } from "vitest";
import { Hub } from "../src/hub.ts";
import { createServiceApp } from "../src/service.ts";
import { addRepo, setDefaultRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { openSession } from "../../core/src/state/sessions.ts";
import { Records } from "../../core/src/store/records.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked, type Tracked } from "../../core/tests/support/tracked.ts";

export interface Service {
  home: string;
  workspace: string;
  hub: Hub;
  app: Hono;
  alpha: Tracked;
  beta: Tracked;
}

const hubs: Hub[] = [];

afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.stop();
});

export async function service(): Promise<Service> {
  const home = await tmpDir("tally-home-");
  const alpha = await makeTracked();
  const beta = await makeTracked();
  await addRepo(home, { root: alpha.root, name: "alpha" });
  await addRepo(home, { root: beta.root, name: "beta" });
  const web = await tmpDir("tally-web-");
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>tally</title>");
  await writeFile(join(web, "assets", "app.js"), "console.info('tally')");
  const workspace = join(alpha.root, "..");
  const hub = new Hub(new Repos(home), { intervalMs: 50 });
  hubs.push(hub);
  return { home, workspace, hub, app: createServiceApp({ hub, webDir: web, workspace }), alpha, beta };
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe("the service for every repository", () => {
  test("says it is up", async () => {
    const { app } = await service();

    expect(await json(await app.request("/api/health"))).toEqual({ ok: true });
  });

  test("lists its repositories with their progress, sessions and the default", async () => {
    const { app, hub, workspace, alpha, beta } = await service();
    const repo = await hub.repos.get("beta");
    await openSession(repo, { worktree: beta.trees["data"] ?? "", agent: "claude" });

    const listed = await json<{ workspace: string; repos: Record<string, unknown>[] }>(await app.request("/api/repos"));

    expect(listed.workspace).toBe(workspace);
    expect(listed.repos.map((r) => [r["name"], r["root"], r["project"], r["sessions"], r["isDefault"]])).toEqual([
      ["alpha", alpha.root, "Test", 0, true],
      ["beta", beta.root, "Test", 1, false],
    ]);
    expect(listed.repos[0]?.["overall"]).toBeTypeOf("number");
    expect(listed.repos[0]?.["problems"]).toBeTypeOf("number");
  });

  test("serves each repository's own board data under its name", async () => {
    const { app, hub } = await service();
    await new Records(await hub.repos.get("beta")).update((ledger) => ({ ledger: { ...ledger, milestones: [] }, message: "emptied" }));

    const rows = async (name: string): Promise<unknown[]> => (await json<{ milestones: unknown[] }>(await app.request(`/api/r/${name}/ledger`))).milestones;

    expect(await rows("alpha")).toHaveLength(1);
    expect(await rows("beta")).toHaveLength(0);
    const snapshot = await json<{ status: { name: string }; state: { sessions: unknown[] } }>(await app.request("/api/r/alpha/snapshot"));
    expect(snapshot.status.name).toBe("Test");
    expect(snapshot.state.sessions).toEqual([]);
  });

  test("answers 404 for a repository that is not listed, naming the ones that are", async () => {
    const { app } = await service();

    const response = await app.request("/api/r/ghost/snapshot");

    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "no repository 'ghost'; listed: alpha, beta" });
  });

  test("answers the old paths, which name no repository, from the default one", async () => {
    const { app, home, hub } = await service();
    await new Records(await hub.repos.get("beta")).update((ledger) => ({ ledger: { ...ledger, milestones: [] }, message: "emptied" }));
    const milestones = async (): Promise<number> => (await json<{ milestones: unknown[] }>(await app.request("/api/ledger"))).milestones.length;
    expect(await milestones()).toBe(1);

    await setDefaultRepo(home, "beta");

    expect(await milestones()).toBe(0);
  });

  test("serves the page at the root, at a repository's board and at its client routes, and assets by their path", async () => {
    const { app } = await service();

    for (const path of ["/", "/r/alpha/", "/r/alpha/evidence"]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<title>tally</title>");
    }
    expect(await (await app.request("/assets/app.js")).text()).toContain("tally");
    expect((await app.request("/assets/none.js")).status).toBe(404);
  });

  test("serves one MCP endpoint for every repository", async () => {
    const { app } = await service();
    const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "repo_list", arguments: {} } };

    const response = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(call) });

    const answer = await json<{ result: { structuredContent: { repos: { name: string }[] } } }>(response);
    expect(answer.result.structuredContent.repos.map((r) => r.name)).toEqual(["alpha", "beta"]);
  });
});

describe("who may call the service", () => {
  test("a request for another host is refused", async () => {
    const { app } = await service();

    const response = await app.request("/api/repos", { headers: { host: "tally.evil.example" } });

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: "tally answers only on this machine's loopback address, not tally.evil.example" });
  });

  test("a request sent by a page of another site is refused", async () => {
    const { app } = await service();

    const response = await app.request("/api/repos", { headers: { origin: "https://evil.example" } });

    expect(response.status).toBe(403);
  });

  test("a page served from another port of this machine is refused", async () => {
    const { app } = await service();

    const response = await app.request("/api/repos", { headers: { host: "127.0.0.1:47560", origin: "http://127.0.0.1:3000" } });

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: "a page of http://127.0.0.1:3000 may not call tally" });
  });

  test("every answer forbids framing and type guessing", async () => {
    const { app } = await service();

    for (const path of ["/", "/api/health", "/api/r/ghost/snapshot"]) {
      const { headers } = await app.request(path);
      expect(headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  test("a path that cannot be read is not found, and a failure says nothing of the server's insides", async () => {
    const { app } = await service();

    expect((await app.request("/%")).status).toBe(404);
  });

  test("a request from the board itself is answered", async () => {
    const { app } = await service();

    const response = await app.request("/api/repos", { headers: { host: "127.0.0.1:47560", origin: "http://127.0.0.1:47560" } });

    expect(response.status).toBe(200);
  });

  test("an operator's action without the operator's header is refused", async () => {
    const { app } = await service();

    const response = await app.request("/api/repos/beta", { method: "DELETE" });

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: "this is the operator's action; it is made from the board" });
  });
});
