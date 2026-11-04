import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import { initRecords, openRepo, type Config } from "@tally/core";
import { startServer, type Running } from "../src/serve.ts";
import { makeRepo, sh } from "../../core/tests/support/repo.ts";

const PATIENCE_MS = 2000;
const HEADERS_ARRIVE_MS = 200;
const STILL_OPEN_MS = 300;

const config: Config = {
  schema: 1, name: "Test", mainBranch: "main", docsDir: "docs", tracks: [], stages: [],
  commands: { test: ["true"], env: {}, unset: [] }, fingerprint: { paths: ["src"], exclude: [] },
  identity: { name: "t", email: "t@example.com" }, records: { dir: "docs/records", commitPrefix: "records:", commit: false }, locks: [],
};

async function serving(): Promise<Running> {
  const repo = await makeRepo();
  await initRecords(repo.root, config, (await repo.head()).slice(0, 7));
  await sh(repo.root, ["add", "-A"]);
  await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
  return startServer({ repo: await openRepo(repo.root), port: 0, host: "127.0.0.1", webDir: repo.root, intervalMs: 50 });
}

function settles(promise: Promise<void>, withinMs: number): Promise<boolean> {
  return Promise.race([promise.then(() => true), delay(withinMs).then(() => false)]);
}

describe("stopping the server", () => {
  test("ends an open event stream and closes, so a board left open in a browser cannot hold it", async () => {
    const server = await serving();
    const reader = (await fetch(`${server.url}events`)).body?.getReader();
    expect((await reader?.read())?.done).toBe(false);

    const closed = await settles(server.close(), PATIENCE_MS);

    expect(closed).toBe(true);
    let ended = false;
    while (!ended) ended = (await reader?.read())?.done ?? true;
    await expect(fetch(`${server.url}api/config`)).rejects.toThrow();
  });

  test("lets a request in flight finish before it closes, so a landing over /mcp is not cut off", async () => {
    const server = await serving();
    const { hostname, port } = new URL(server.url);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const socket = connect(Number(port), hostname);
    const reply = new Promise<string>((done) => {
      let text = "";
      socket.on("data", (chunk) => (text += chunk.toString()));
      socket.on("close", () => done(text));
    });
    socket.write(`POST /mcp HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: ${body.length}\r\n\r\n${body.slice(0, 5)}`);
    await delay(HEADERS_ARRIVE_MS);

    const closing = server.close();

    expect(await settles(closing, STILL_OPEN_MS)).toBe(false);
    socket.write(body.slice(5));
    expect(await reply).toContain("HTTP/1.1 200");
    expect(await settles(closing, PATIENCE_MS)).toBe(true);
  });
});
