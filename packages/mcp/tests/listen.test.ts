import { describe, expect, test } from "vitest";
import { mcpEndpoint } from "../src/endpoint.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { LISTENING, newerInit, readUntil } from "./support/newer.ts";

const AT = "http://127.0.0.1/mcp";

describe("a listen stream on 2026-07-28", () => {
  test("is acknowledged with nothing honoured and ended at once, since tally's list does not change, and holds nothing", async () => {
    const { repo } = await makeTracked();
    const endpoint = mcpEndpoint(repo);

    const listened = await endpoint.fetch(new Request(AT, newerInit("subscriptions/listen", LISTENING)));
    const heard = await readUntil(listened.body, "never");
    const called = await endpoint.fetch(new Request(AT, newerInit("tools/call", { name: "decision_list", arguments: {} })));

    expect(listened.headers.get("content-type")).toBe("text/event-stream");
    expect(heard).toContain('"notifications":{}');
    expect(heard).toContain('"resultType":"complete"');
    expect(endpoint.listening()).toBe(0);
    expect(((await called.json()) as { result: { structuredContent: unknown } }).result.structuredContent).toMatchObject({ decisions: [] });
    await endpoint.close();
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
