import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, test } from "vitest";
import { readUsage, usagePathOf } from "../../core/src/usage/counts.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { ENVELOPE, NEWER } from "../../mcp/tests/support/newer.ts";
import { mcpCommand } from "../src/commands/mcp.ts";
import type { IO } from "../src/io.ts";

const MOST_WAIT_MS = 3_000;
const LISTED = 81;

async function withOnly<T>(signal: "SIGINT" | "SIGTERM", body: () => Promise<T>): Promise<T> {
  const others = process.listeners(signal);
  process.removeAllListeners(signal);
  try {
    return await body();
  } finally {
    process.removeAllListeners(signal);
    for (const listener of others) process.on(signal, listener);
  }
}

const quiet = (cwd: string): IO => ({ out: () => undefined, err: () => undefined, cwd, env: {}, columns: 120, isTTY: false });

const settled = (running: Promise<number>, ms: number): Promise<string> => Promise.race([running.then(() => "returned"), new Promise<string>((done) => setTimeout(() => done("still running"), ms))]);

interface Line {
  id?: number;
  result?: { tools?: unknown[]; supportedVersions?: string[]; capabilities?: unknown; protocolVersion?: string; isError?: boolean; content?: { text?: string }[] };
  error?: { message: string };
}

async function stdio() {
  const { repo } = await makeTracked();
  const input = new PassThrough();
  const output = new PassThrough();
  const answers = createInterface({ input: output })[Symbol.asyncIterator]();
  const serving = mcpCommand(repo, "a repository", quiet(repo.root), { stateDir: repo.stateDir }, { input, output });
  const ask = async (message: Record<string, unknown>): Promise<Line> => {
    input.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    return JSON.parse((await answers.next()).value as string) as Line;
  };
  const counted = async (): Promise<number | undefined> => (await readUsage(usagePathOf({ stateDir: repo.stateDir }))).tools["board_get"]?.calls;
  return { input, output, serving, ask, counted };
}

const older = { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "0" } };

async function calledOnOlder(ask: (message: Record<string, unknown>) => Promise<Line>, input: PassThrough): Promise<Line> {
  await ask({ id: 1, method: "initialize", params: older });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return ask({ id: 2, method: "tools/call", params: { name: "board_get", arguments: {} } });
}

describe("tally mcp on stdio", () => {
  test("serves 2026-07-28: discover, the whole list, a read and a refusal", async () => {
    const { input, serving, ask } = await stdio();

    const discovered = await ask({ id: 1, method: "server/discover", params: { _meta: ENVELOPE } });
    const listed = await ask({ id: 2, method: "tools/list", params: { _meta: ENVELOPE } });
    const read = await ask({ id: 3, method: "tools/call", params: { name: "board_get", arguments: {}, _meta: ENVELOPE } });
    const refused = await ask({ id: 4, method: "tools/call", params: { name: "board_get", arguments: { bogus: 1 }, _meta: ENVELOPE } });
    input.end();
    await serving;

    expect(discovered.result?.supportedVersions).toContain(NEWER);
    expect(discovered.result?.capabilities).toEqual({ tools: { listChanged: false } });
    expect(listed.result?.tools).toHaveLength(LISTED);
    expect(read.result?.isError).toBeUndefined();
    expect(refused.result?.isError).toBe(true);
    expect(refused.result?.content?.[0]?.text).toMatch(/^Invalid arguments for tool board_get: board_get takes no 'bogus'/);
  });

  test("serves 2025-03-26 as before: initialize, the whole list and a read", async () => {
    const { input, serving, ask } = await stdio();

    const opened = await ask({ id: 1, method: "initialize", params: older });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await ask({ id: 2, method: "tools/list", params: {} });
    const read = await ask({ id: 3, method: "tools/call", params: { name: "board_get", arguments: {} } });
    input.end();
    await serving;

    expect(opened.result?.protocolVersion).toBe("2025-03-26");
    expect(listed.result?.tools).toHaveLength(LISTED);
    expect(read.result?.isError).toBeUndefined();
  });

  test.each([["destroyed", undefined], ["broken, as when the host has gone", new Error("write EPIPE")]] as const)("ends when its output is %s, and writes its count first", async (_how, broken) => {
    const { input, output, serving, ask, counted } = await stdio();
    await calledOnOlder(ask, input);

    output.destroy(broken);

    expect(await settled(serving, MOST_WAIT_MS)).toBe("returned");
    expect(await counted()).toBe(1);
  });

  test.each(["SIGINT", "SIGTERM"] as const)("ends on %s, and writes its count first", async (signal) => {
    const { ended, counted } = await withOnly(signal, async () => {
      const { input, serving, ask, counted: count } = await stdio();
      await calledOnOlder(ask, input);
      process.emit(signal);
      return { ended: await settled(serving, MOST_WAIT_MS), counted: count };
    });

    expect(ended).toBe("returned");
    expect(await counted()).toBe(1);
  });
});
