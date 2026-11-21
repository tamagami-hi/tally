import { join } from "node:path";
import { Client, StreamableHTTPClientTransport, type ElicitResult } from "@modelcontextprotocol/client";
import { McpServer, acceptedContent, createMcpHandler, inputRequired, type ServerContext } from "@modelcontextprotocol/server";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Usage, USAGE_FILE } from "../../core/src/usage/counts.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { decorating } from "../src/decorate.ts";
import { listing } from "../src/listing.ts";
import { ok } from "../src/respond.ts";
import { oneRepo } from "../src/source.ts";
import { NEWER } from "./support/newer.ts";

const FORM = z.object({ confirm: z.boolean() });
const ACCEPTS: ElicitResult = { action: "accept", content: { confirm: true } };

async function askingOnce() {
  const { repo } = await makeTracked();
  const usage = await Usage.open(join(await tmpDir("tally-usage-"), USAGE_FILE), "0.9.3");
  const build = (): McpServer => {
    const server = new McpServer({ name: "tally", version: "0" });
    const tools = decorating(server, oneRepo(repo), { usage });
    tools.registerTool("board_get", { description: "asks once, then answers" }, async (_args: unknown, extra: unknown) => {
      const accepted = acceptedContent((extra as ServerContext).mcpReq.inputResponses, "confirm", FORM);
      if (accepted === undefined) return inputRequired({ inputRequests: { confirm: inputRequired.elicit({ message: "go on?", requestedSchema: FORM }) } });
      return ok({ confirmed: accepted.confirm });
    });
    listing(server, tools.listed());
    return server;
  };
  const handler = createMcpHandler(build, { legacy: "reject", responseMode: "json" });
  const asked: string[] = [];
  const client = new Client({ name: "agent", version: "0" }, { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: { pin: NEWER } } });
  client.setRequestHandler("elicitation/create", async (request) => {
    asked.push(request.params.message);
    return ACCEPTS;
  });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1/mcp"), { fetch: (url, init) => handler.fetch(new Request(url, init)) }));
  return { client, usage, asked, handler };
}

describe("a round that asks the person", () => {
  test("goes back to the client as it is, uncounted, and the call that finishes is decorated and counted once", async () => {
    const { client, usage, asked, handler } = await askingOnce();

    const result = await client.callTool({ name: "board_get", arguments: {} });
    await client.close();
    await handler.close();

    expect(asked).toEqual(["go on?"]);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ confirmed: true });
    expect(usage.snapshot().tools["board_get"]).toMatchObject({ calls: 1, refused: 0, invalid: 0 });
  });
});
