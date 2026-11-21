import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkPort, serveForCheck } from "./support/check-serve.ts";
import { BARE_HEADERS } from "./support/wire.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { newerInit } from "../../mcp/tests/support/newer.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  return typeof address === "object" && address !== null ? address.port : 0;
}

describe("the port of the planner's check", () => {
  test("is never the service's own, 47560", () => {
    expect(() => checkPort("47560")).toThrow("the check never serves on 47560, the operator's service's port; pick another");
  });

  test("is a port number on the loopback address", () => {
    expect(() => checkPort("not-a-port")).toThrow("CHECK_PORT must be a port number from 1024 to 65535, not not-a-port");
    expect(() => checkPort("80")).toThrow("CHECK_PORT must be a port number from 1024 to 65535, not 80");
    expect(checkPort("47561")).toBe(47561);
  });
});

describe("the planner's check", () => {
  test("logs each MCP request's method, revision and status", async () => {
    const out = join(await tmpDir("tally-check-"), "requests.log");
    const checking = await serveForCheck(checkPort(String(await freePort())), out);

    await (await fetch(new URL("mcp", checking.url), newerInit("tools/list", {}))).text();
    await (await fetch(new URL("r/beta/mcp/builder", checking.url), { method: "POST", headers: BARE_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }) })).text();
    await checking.close();

    const lines = (await readFile(out, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => [line["path"], line["method"], line["revision"], line["status"]])).toEqual([
      ["/mcp", "tools/list", "2026-07-28", 200],
      ["/r/beta/mcp/builder", "tools/call", "2025 (no revision named)", 200],
    ]);
  });
});
