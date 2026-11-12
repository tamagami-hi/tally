import type { Hono } from "hono";
import { afterEach, describe, expect, test } from "vitest";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import type { CliAnswer, CliRunner } from "../src/cli-api.ts";
import { Hub } from "../src/hub.ts";
import { createServiceApp } from "../src/service.ts";

const CLI = { "content-type": "application/json", "x-tally-cli": "1" };
const RAN: CliAnswer = { exit: 0, lines: [{ to: "out", text: "ran" }] };

interface Fixture {
  app: Hono;
  calls: { argv: string[]; cwd: string }[];
  root: string;
  outside: string;
}

const hubs: Hub[] = [];

afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.stop();
});

async function fixture(withRunner = true): Promise<Fixture> {
  const home = await tmpDir("tally-home-");
  const { root } = await makeTracked();
  await addRepo(home, { root, name: "alpha" });
  const hub = new Hub(new Repos(home), { intervalMs: 50 });
  hubs.push(hub);
  const calls: Fixture["calls"] = [];
  const cli: CliRunner = async (argv, cwd) => {
    calls.push({ argv, cwd });
    return RAN;
  };
  const app = createServiceApp({ hub, webDir: await tmpDir("tally-web-"), workspace: root, ...(withRunner ? { cli } : {}) });
  return { app, calls, root, outside: await tmpDir("tally-outside-") };
}

const post = (app: Hono, path: string, body: unknown, headers: Record<string, string> = CLI): Promise<Response> =>
  Promise.resolve(app.request(path, { method: "POST", headers, body: JSON.stringify(body) }));

const errorOf = async (response: Response): Promise<string> => ((await response.json()) as { error: string }).error;

describe("the command line's endpoint", () => {
  test("runs a command for a folder inside the workspace and answers what it printed", async () => {
    const { app, calls, root } = await fixture();

    const response = await post(app, "/api/cli", { argv: ["status", "--json"], cwd: root });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RAN);
    expect(calls).toEqual([{ argv: ["status", "--json"], cwd: root }]);
  });

  test("refuses every route without the command's header", async () => {
    const { app, calls, root } = await fixture();
    const plain = { "content-type": "application/json" };

    expect((await post(app, "/api/cli", { argv: ["status"], cwd: root }, plain)).status).toBe(403);
    expect((await post(app, "/api/cli/land", { cwd: root, track: "data" }, plain)).status).toBe(403);
    expect((await app.request("/api/cli/land/alpha/t1")).status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("refuses a body a page could send without asking first", async () => {
    const { app, calls, root } = await fixture();

    const response = await post(app, "/api/cli", { argv: ["status"], cwd: root }, { "content-type": "text/plain", "x-tally-cli": "1" });

    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test.each([[["--repo", "/x", "serve"], "serve"], [["--repo=/x", "mcp"], "mcp"], [["land", "data"], "land"]])("does not run %j, which belongs on the caller's machine", async (argv, command) => {
    const { app, calls, root } = await fixture();

    const response = await post(app, "/api/cli", { argv, cwd: root });

    expect(await response.json()).toEqual({ exit: 2, lines: [{ to: "err", text: `tally ${command} runs on your own machine, not in the service` }] });
    expect(calls).toEqual([]);
  });

  test("refuses a repository outside the workspace, named or as the current folder", async () => {
    const { app, calls, root, outside } = await fixture();

    const named = await post(app, "/api/cli", { argv: ["--repo", outside, "status"], cwd: root });
    const current = await post(app, "/api/cli", { argv: ["task", "plan", "B2", "--track", "data", "a task"], cwd: outside });

    expect(named.status).toBe(400);
    expect(await errorOf(named)).toContain(`${outside} is not a folder inside the workspace`);
    expect(await errorOf(current)).toContain(`${outside} is not a folder inside the workspace`);
    expect(calls).toEqual([]);
  });

  test("adds a repository only from inside the workspace", async () => {
    const { app, calls, root, outside } = await fixture();

    const refused = await post(app, "/api/cli", { argv: ["repo", "add", "--name", "other", outside], cwd: root });
    const allowed = await post(app, "/api/cli", { argv: ["repo", "add", "--name", "again", "."], cwd: root });

    expect(await errorOf(refused)).toContain(`${outside} is not a folder inside the workspace`);
    expect(allowed.status).toBe(200);
    expect(calls).toEqual([{ argv: ["repo", "add", "--name", "again", "."], cwd: root }]);
  });

  test("runs what needs no repository from any folder", async () => {
    const { app, calls, outside } = await fixture();

    await post(app, "/api/cli", { argv: ["repo", "list"], cwd: outside });
    await post(app, "/api/cli", { argv: ["task", "--help"], cwd: outside });

    expect(calls.map((call) => call.argv)).toEqual([["repo", "list"], ["task", "--help"]]);
  });

  test("says so when the service was started without the command line", async () => {
    const { app, root } = await fixture(false);

    const response = await post(app, "/api/cli", { argv: ["status"], cwd: root });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("this service was started without the command line");
  });

  test("refuses a request that does not fit, and says where", async () => {
    const { app, root } = await fixture();

    const response = await post(app, "/api/cli", { argv: "status", cwd: root });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain("the request does not fit: argv");
  });
});
