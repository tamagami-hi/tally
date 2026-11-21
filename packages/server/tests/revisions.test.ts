import { describe, expect, test } from "vitest";
import { service } from "./support/service.ts";
import { ADDRESSES, BARE_HEADERS, NEWER_REVISION, OLDER_REVISIONS, answerOf, bare, bareSurface, joinedText, newerClient, refusalOf, surfaceOf } from "./support/wire.ts";

const UNKNOWN_ARGUMENT = "Invalid arguments for tool decision_list: decision_list takes no 'bogus'; it takes group, ids, unconfirmed, limit, sessionId, repo";
const NO_SESSION = "no session s-none; open one with session_open";
const LATEST_OLDER = "2025-11-25";

const initializing = (protocolVersion: string): Record<string, unknown> => ({ protocolVersion, capabilities: {}, clientInfo: { name: "raw", version: "0" } });

async function rawAt(app: Awaited<ReturnType<typeof service>>["app"], path: string, version: string, method: string, params: Record<string, unknown>): Promise<Response> {
  return app.request(path, { method: "POST", headers: { ...BARE_HEADERS, "mcp-protocol-version": version }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }) });
}

describe.each(ADDRESSES)("both revisions at %s", (path) => {
  test.each(OLDER_REVISIONS)("a raw initialize at %s connects, lists and calls, each answer one JSON body", async (version) => {
    const { app } = await service();

    const opened = await answerOf(await bare(app, path, "initialize", initializing(version)));
    const listed = await rawAt(app, path, version, "tools/list", {});
    const called = await rawAt(app, path, version, "tools/call", { name: "decision_list", arguments: {} });

    expect(opened.result).toMatchObject({ protocolVersion: version, serverInfo: { name: "tally" } });
    expect(listed.headers.get("content-type")).toMatch(/^application\/json/);
    expect(surfaceOf((await answerOf(listed)).result?.tools ?? [])).toEqual(await bareSurface(app, path));
    expect(called.headers.get("content-type")).toMatch(/^application\/json/);
    expect(JSON.parse(joinedText(await answerOf(called)))).toMatchObject({ decisions: [] });
  });

  test("an initialize that offers 2026-07-28 is answered with 2025-11-25, as before", async () => {
    const { app } = await service();

    const opened = await answerOf(await bare(app, path, "initialize", initializing(NEWER_REVISION)));

    expect(opened.result).toMatchObject({ protocolVersion: LATEST_OLDER });
  });

  test("a client pinned to 2026-07-28 connects, lists the same tools and is refused in the same words", async () => {
    const { app } = await service();
    const client = await newerClient(app, path);

    const listed = await client.listTools();
    const read = await client.callTool({ name: "decision_list", arguments: {} });

    expect(client.getProtocolEra()).toBe("modern");
    expect(surfaceOf(listed.tools)).toEqual(await bareSurface(app, path));
    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toMatchObject({ decisions: [] });
    expect(await refusalOf(client, "decision_list", { bogus: 1 })).toEqual({ isError: true, text: UNKNOWN_ARGUMENT });
    expect(await refusalOf(client, "session_close", { sessionId: "s-none" })).toEqual({ isError: true, text: NO_SESSION });
    expect(await refusalOf(client, "no_such_tool", {})).toEqual({ isError: true, text: "Tool no_such_tool not found", code: -32602 });
    await client.close();
  });
});
