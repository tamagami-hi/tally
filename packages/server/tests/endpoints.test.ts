import { rm } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import { startService } from "../src/serve.ts";
import { service } from "./support/service.ts";
import { answerOf, bare, bareCall } from "./support/wire.ts";
import { stateDirOf } from "../../core/src/repos/home.ts";
import { addRepo, removeRepo } from "../../core/src/repos/list.ts";
import { Records } from "../../core/src/store/records.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { LISTENING, newerInit, readUntil, until } from "../../mcp/tests/support/newer.ts";

interface Made {
  closed: number;
  listening: () => number;
}

const made = vi.hoisted(() => ({ all: [] as Made[] }));

vi.mock("@tally/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tally/mcp")>();
  return {
    ...actual,
    mcpEndpoint: (...args: Parameters<typeof actual.mcpEndpoint>) => {
      const real = actual.mcpEndpoint(...args);
      const seen: Made = { closed: 0, listening: real.listening };
      made.all.push(seen);
      return {
        ...real,
        close: async () => {
          seen.closed += 1;
          await real.close();
        },
      };
    },
  };
});

const ADDRESSES = ["/mcp", "/mcp/builder", "/r/alpha/mcp", "/r/alpha/mcp/reviewer"];
const REQUESTS_EACH = 3;

const rowsAt = async (app: Awaited<ReturnType<typeof service>>["app"], path: string): Promise<number> => ((await answerOf(await bareCall(app, path, "board_get"))).result as { structuredContent: { rows: unknown[] } }).structuredContent.rows.length;

describe("the service's MCP handlers", () => {
  test("are made once for each address, however many requests it is sent", async () => {
    made.all = [];
    const { app } = await service();

    for (const path of ADDRESSES) for (let sent = 0; sent < REQUESTS_EACH; sent += 1) await bare(app, path, "tools/list", {});

    expect(made.all).toHaveLength(ADDRESSES.length);
  });

  test("never serve a repository listed again at another folder from the old handler, which is closed", async () => {
    made.all = [];
    const { app, home } = await service();
    const before = await rowsAt(app, "/r/beta/mcp");
    const moved = await makeTracked();
    await new Records(moved.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [] }, message: "emptied" }));
    await removeRepo(home, "beta");
    await rm(stateDirOf(home, "beta"), { recursive: true, force: true });
    await addRepo(home, { root: moved.root, name: "beta" });

    const after = await rowsAt(app, "/r/beta/mcp");

    expect([before > 0, after]).toEqual([true, 0]);
    expect(made.all.map((one) => one.closed)).toEqual([1, 0]);
  });

  test("close the handler of a repository taken off the list once the list is read again", async () => {
    made.all = [];
    const { app, home, hub } = await service();
    await bare(app, "/r/beta/mcp", "tools/list", {});
    await removeRepo(home, "beta");

    await hub.sync();

    expect(made.all.map((one) => one.closed)).toEqual([1]);
    expect((await bare(app, "/r/beta/mcp", "tools/list", {})).status).toBe(404);
  });

  test("are all closed when the service stops", async () => {
    made.all = [];
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });
    const running = await startService({ home, workspace: await tmpDir("tally-workspace-"), port: 0, host: "127.0.0.1", webDir: root, intervalMs: 50 });
    for (const path of ADDRESSES) await fetch(new URL(path.slice(1), running.url), { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });

    await running.close();

    expect(made.all.length).toBeGreaterThanOrEqual(ADDRESSES.length);
    expect(made.all.every((one) => one.closed === 1)).toBe(true);
  });

  test("let go of what a listen stream held when its client goes away", async () => {
    made.all = [];
    const home = await tmpDir("tally-home-");
    const running = await startService({ home, workspace: await tmpDir("tally-workspace-"), port: 0, host: "127.0.0.1", webDir: home, intervalMs: 50 });
    const gone = new AbortController();

    const listened = await fetch(new URL("mcp", running.url), newerInit("subscriptions/listen", LISTENING, gone.signal));
    await readUntil(listened.body, "acknowledged");
    const held = made.all.reduce((sum, one) => sum + one.listening(), 0);
    gone.abort();
    const released = await until(() => made.all.every((one) => one.listening() === 0));
    await running.close();

    expect([held, released]).toEqual([1, true]);
  });
});
