import { afterEach, describe, expect, test, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { askEndpoint, endpointFor, mcpEndpoint } from "../src/endpoint.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { newerInit } from "./support/newer.ts";

const AT = "http://127.0.0.1/mcp";
const FORMS = { elicitation: { form: {} } };

afterEach(() => {
  vi.restoreAllMocks();
});

function heardLog(): string[] {
  const said: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => said.push(String(chunk)) > 0);
  for (const level of ["warn", "error", "log", "info"] as const) vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => void said.push(parts.map(String).join(" ")));
  return said;
}

describe("the MCP handlers and the service's log", () => {
  test("making a handler writes nothing to the log", async () => {
    const { repo } = await makeTracked();
    const said = heardLog();

    const made = [mcpEndpoint(repo), mcpEndpoint(repo, undefined, "builder"), askEndpoint()];
    await Promise.all(made.map((endpoint) => endpoint.close()));

    expect(said).toEqual([]);
  });

  test("an error inside the SDK's handler on 2026-07-28 writes one line", async () => {
    const endpoint = endpointFor((revision) => {
      if (revision === "modern") throw new Error("the factory broke");
      return new McpServer({ name: "tally", version: "0" });
    });
    const said = heardLog();

    const answer = await endpoint.fetch(new Request(AT, newerInit("tools/list", {})));
    await endpoint.close();

    expect(answer.status).toBe(500);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^tally's MCP handler on 2026-07-28: .*the factory broke\n$/);
  });

  test("answers every call on 2026-07-28 as one JSON body: a list, a read, refusals and a round that asks", async () => {
    const { repo } = await makeTracked();
    const endpoint = mcpEndpoint(repo);
    const asking = askEndpoint();
    const sent = [
      [endpoint, newerInit("tools/list", {})],
      [endpoint, newerInit("tools/call", { name: "board_get", arguments: {} })],
      [endpoint, newerInit("tools/call", { name: "board_get", arguments: { bogus: 1 } })],
      [endpoint, newerInit("tools/call", { name: "no_such_tool", arguments: {} })],
      [asking, newerInit("tools/call", { name: "ask_trial", arguments: { about: "Go on?" } }, undefined, FORMS)],
    ] as const;

    const types = await Promise.all(sent.map(async ([to, init]) => {
      const answer = await to.fetch(new Request(AT, init));
      return [answer.headers.get("content-type"), typeof JSON.parse(await answer.text())];
    }));
    await Promise.all([endpoint.close(), asking.close()]);

    expect(types).toEqual(sent.map(() => ["application/json", "object"]));
  });
});
