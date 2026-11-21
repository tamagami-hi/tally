import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, test } from "vitest";
import { service } from "./support/service.ts";
import { ADDRESSES, bareSurface, intoApp, surfaceOf } from "./support/wire.ts";

const UNKNOWN_ARGUMENT = "Invalid arguments for tool decision_list: decision_list takes no 'bogus'; it takes group, ids, unconfirmed, limit, sessionId, repo";

const textOf = (result: { content?: unknown }): string => ((result.content ?? []) as { text?: string }[]).map((part) => part.text ?? "").join("\n");

describe.each(ADDRESSES)("a client of version 1 of the SDK at %s", (path) => {
  test("connects on 2025-11-25, lists the same tools, calls one, and is refused in tally's words", async () => {
    const { app } = await service();
    const client = new Client({ name: "older", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1${path}`), { fetch: intoApp(app) });
    await client.connect(transport);

    const listed = await client.listTools();
    const read = await client.callTool({ name: "decision_list", arguments: {} });
    const refused = await client.callTool({ name: "decision_list", arguments: { bogus: 1 } });

    expect(transport.protocolVersion).toBe("2025-11-25");
    expect(client.getServerVersion()?.name).toBe("tally");
    expect(surfaceOf(listed.tools)).toEqual(await bareSurface(app, path));
    expect(JSON.parse(textOf(read))).toMatchObject({ decisions: [] });
    expect([refused.isError, textOf(refused)]).toEqual([true, UNKNOWN_ARGUMENT]);
    await client.close();
  });
});
