import { describe, expect, test } from "vitest";
import { startService } from "../src/serve.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { LISTENING, newerInit, readUntil } from "../../mcp/tests/support/newer.ts";

const MOST_STOP_MS = 2000;

const settles = (promise: Promise<unknown>, withinMs: number): Promise<boolean> =>
  Promise.race([promise.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), withinMs))]);

describe("stopping the service", () => {
  test("takes under two seconds with a listen stream and a 2025-era stream open", async () => {
    const home = await tmpDir("tally-home-");
    const running = await startService({ home, workspace: await tmpDir("tally-workspace-"), port: 0, host: "127.0.0.1", webDir: home, intervalMs: 50 });
    const clients = new AbortController();
    const listened = await fetch(new URL("mcp", running.url), newerInit("subscriptions/listen", LISTENING, clients.signal));
    await readUntil(listened.body, "acknowledged");
    await fetch(new URL("mcp/builder", running.url), { method: "GET", headers: { accept: "text/event-stream" }, signal: clients.signal });

    const closing = running.close();
    const stopped = await settles(closing, MOST_STOP_MS);
    clients.abort();
    await closing;

    expect(stopped).toBe(true);
  });
});
