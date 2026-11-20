import { createServer } from "node:net";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, test, vi } from "vitest";
import { readUsage, usagePathOf } from "../../core/src/usage/counts.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { mcpCommand } from "../src/commands/mcp.ts";
import { serveListCommand } from "../src/commands/serve.ts";
import type { IO } from "../src/io.ts";
import { run } from "../src/run.ts";
import { serviceCli } from "../src/service-cli.ts";

interface Captured extends IO {
  lines: string[];
}

function io(cwd: string, env: NodeJS.ProcessEnv): Captured {
  const captured: Captured = { lines: [], out: (line) => captured.lines.push(line), err: () => undefined, cwd, env, columns: 120, isTTY: false };
  return captured;
}

const settled = (running: Promise<number>, ms: number): Promise<string> => Promise.race([running.then(() => "returned"), new Promise<string>((done) => setTimeout(() => done("still running"), ms))]);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  return typeof address === "object" && address !== null ? address.port : 0;
}

async function withSigterm<T>(body: () => Promise<T>): Promise<T> {
  const others = process.listeners("SIGTERM");
  process.removeAllListeners("SIGTERM");
  try {
    return await body();
  } finally {
    process.removeAllListeners("SIGTERM");
    for (const listener of others) process.on("SIGTERM", listener);
  }
}

describe("a server that stops", () => {
  test("tally mcp on stdio returns and writes its count when its input ends", async () => {
    const { repo } = await makeTracked();
    const input = new PassThrough();
    const output = new PassThrough();
    const answers = createInterface({ input: output })[Symbol.asyncIterator]();
    const serving = mcpCommand(repo, "a repository", io(repo.root, {}), { stateDir: repo.stateDir }, { input, output });
    const send = (message: unknown): void => void input.write(`${JSON.stringify(message)}\n`);

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    await answers.next();
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "board_get", arguments: {} } });
    await answers.next();
    input.end();

    expect(await settled(serving, 3_000)).toBe("returned");
    expect((await readUsage(usagePathOf({ stateDir: repo.stateDir }))).tools["board_get"]?.calls).toBe(1);
  });

  test("the service writes its count when it is sent SIGTERM, as docker stop sends", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });
    const env = { TALLY_HOME: home };
    const captured = io(root, env);

    await withSigterm(async () => {
      const serving = serveListCommand(["--port", String(await freePort()), "--web-dir", root], captured, serviceCli(run, env));
      await vi.waitFor(() => expect(captured.lines.join("\n")).toContain("tally serves every listed repository at "), { timeout: 4_000, interval: 50 });
      const url = /at (http\S+)/.exec(captured.lines.join("\n"))?.[1] ?? "";
      await (await fetch(`${url}mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "board_get", arguments: {} } }) })).text();
      process.emit("SIGTERM");
      expect(await settled(serving, 3_000)).toBe("returned");
    });

    expect((await readUsage(usagePathOf({ home }))).tools["board_get"]?.calls).toBe(1);
  });
});
