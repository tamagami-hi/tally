import { connect, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { startServer, startService, type Running } from "../src/serve.ts";
import { addRepo, removeRepo } from "../../core/src/repos/list.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const GRACE_MS = 300;
const CUT_AFTER_MS = 500;
const MARGIN_MS = 1500;
const MOST_STOP_MS = GRACE_MS + CUT_AFTER_MS + MARGIN_MS;
const DECLARED_BODY = 1000;
const IN_FLIGHT_MS = 300;
const LIST_INTERVAL_MS = 50;

const open: Socket[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (open.length > 0) open.pop()?.destroy();
});

async function stalled(running: Running, path: string, headers: Record<string, string> = {}): Promise<void> {
  const { port } = new URL(running.url);
  const socket = connect(Number(port), "127.0.0.1");
  open.push(socket);
  socket.on("error", () => undefined);
  await new Promise((connected) => socket.once("connect", connected));
  const head = Object.entries({ host: `127.0.0.1:${port}`, "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": String(DECLARED_BODY), ...headers }).map(([name, value]) => `${name}: ${value}\r\n`).join("");
  socket.write(`POST ${path} HTTP/1.1\r\n${head}\r\n{"jsonrpc":"2.0","id":1,`);
  await delay(IN_FLIGHT_MS);
}

function heardLog(): string[] {
  const said: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => said.push(String(chunk)) > 0);
  return said;
}

async function stopTook(running: Running): Promise<number> {
  const started = Date.now();
  const outcome = await Promise.race([running.close().then(() => "stopped"), delay(MOST_STOP_MS * 4).then(() => "still stopping")]);
  return outcome === "stopped" ? Date.now() - started : Number.POSITIVE_INFINITY;
}

async function service() {
  const home = await tmpDir("tally-home-");
  await addRepo(home, { root: (await makeTracked()).root, name: "alpha" });
  await addRepo(home, { root: (await makeTracked()).root, name: "beta" });
  const running = await startService({ home, workspace: home, port: 0, host: "127.0.0.1", webDir: home, intervalMs: LIST_INTERVAL_MS, stopGraceMs: GRACE_MS });
  return { home, running };
}

const wholeCall = (running: Running): Promise<number> => fetch(new URL("mcp", running.url), { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) }).then((answer) => answer.status);

describe("a stop with a POST whose body stalls", () => {
  test.each([["alone", false], ["beside a whole call", true]] as const)("settles within the grace and the cut, %s, and names it as a request", async (_how, beside) => {
    const { running } = await service();
    await stalled(running, "/mcp");
    const answered = beside ? await wholeCall(running) : 200;
    const said = heardLog();

    const tookMs = await stopTook(running);

    expect(answered).toBe(200);
    expect(tookMs).toBeLessThan(MOST_STOP_MS);
    expect(said.filter((line) => line.startsWith("tally stopped waiting for a request at /mcp"))).toHaveLength(1);
    expect(said.filter((line) => line.startsWith("tally failed"))).toEqual([]);
  });

  test("names the method and the tool when the request's head says them", async () => {
    const { running } = await service();
    await stalled(running, "/mcp", { "mcp-method": "tools/call", "mcp-name": "note_post", "mcp-protocol-version": "2026-07-28" });
    const said = heardLog();

    const tookMs = await stopTook(running);

    expect(tookMs).toBeLessThan(MOST_STOP_MS);
    expect(said.filter((line) => line.startsWith("tally stopped waiting for tools/call note_post at /mcp"))).toHaveLength(1);
  });

  test("settles in a server of one repository, and logs no failure for the request it cut", async () => {
    const { repo } = await makeTracked();
    const running = await startServer({ repo, port: 0, host: "127.0.0.1", webDir: repo.root, intervalMs: LIST_INTERVAL_MS, stopGraceMs: GRACE_MS });
    await stalled(running, "/mcp/builder");
    const said = heardLog();

    const tookMs = await stopTook(running);
    await delay(IN_FLIGHT_MS);

    expect(tookMs).toBeLessThan(MOST_STOP_MS);
    expect(said.filter((line) => line.startsWith("tally failed"))).toEqual([]);
  });

  test("settles when the stalled request's handler is being handed over, its repository taken off the list", async () => {
    const { home, running } = await service();
    await stalled(running, "/r/beta/mcp");
    await removeRepo(home, "beta");
    await delay(LIST_INTERVAL_MS * 4);
    heardLog();

    expect(await stopTook(running)).toBeLessThan(MOST_STOP_MS);
  });
});
