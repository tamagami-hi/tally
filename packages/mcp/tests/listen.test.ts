import { describe, expect, test } from "vitest";
import { mcpEndpoint } from "../src/endpoint.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { LISTENING, newerInit, readUntil, until } from "./support/newer.ts";

const AT = "http://127.0.0.1/mcp";
const KEEP_ALIVE_MS = 25;

describe("a listen stream on 2026-07-28", () => {
  test("stays open with the SDK's keep-alive, and a call on another request is answered meanwhile", async () => {
    const { repo } = await makeTracked();
    const endpoint = mcpEndpoint(repo, undefined, undefined, { keepAliveMs: KEEP_ALIVE_MS });
    const gone = new AbortController();

    const listened = await endpoint.fetch(new Request(AT, newerInit("subscriptions/listen", LISTENING, gone.signal)));
    const heard = await readUntil(listened.body, ": keepalive");
    const called = await endpoint.fetch(new Request(AT, newerInit("tools/call", { name: "decision_list", arguments: {} })));

    expect(listened.headers.get("content-type")).toBe("text/event-stream");
    expect(heard).toContain('"notifications":{"toolsListChanged":true}');
    expect(heard).toContain(": keepalive");
    expect(called.headers.get("content-type")).toMatch(/^application\/json/);
    expect(((await called.json()) as { result: { structuredContent: unknown } }).result.structuredContent).toMatchObject({ decisions: [] });
    expect(endpoint.listening()).toBe(1);
    gone.abort();
    expect(await until(() => endpoint.listening() === 0)).toBe(true);
    await endpoint.close();
  });

  test("is ended when its endpoint closes, as a stop does", async () => {
    const { repo } = await makeTracked();
    const endpoint = mcpEndpoint(repo);
    const listened = await endpoint.fetch(new Request(AT, newerInit("subscriptions/listen", LISTENING)));
    await readUntil(listened.body, "acknowledged");

    await endpoint.close();

    expect(await readUntil(listened.body, "never")).toContain('"resultType":"complete"');
    expect(endpoint.listening()).toBe(0);
  });
});

describe("a 2025-era GET stream", () => {
  test("is let go when its client goes away, and ended when its endpoint closes", async () => {
    const { repo } = await makeTracked();
    const endpoint = mcpEndpoint(repo);
    const gone = new AbortController();
    const headers = { accept: "text/event-stream" };

    await endpoint.fetch(new Request(AT, { method: "GET", headers, signal: gone.signal }));
    const kept = await endpoint.fetch(new Request(AT, { method: "GET", headers }));
    const held = endpoint.listening();
    gone.abort();
    const afterOneLeft = endpoint.listening();
    await endpoint.close();

    expect([held, afterOneLeft, endpoint.listening()]).toEqual([2, 1, 0]);
    expect(await kept.body?.getReader().read()).toMatchObject({ done: true });
  });
});
