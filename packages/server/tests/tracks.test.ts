import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import { startServer } from "../src/serve.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const PATIENCE_MS = 3000;
const STEP_MS = 40;

async function call(url: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const response = await fetch(`${url}mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body });
  const answer = (await response.json()) as { result: { structuredContent?: Record<string, unknown>; content: { text: string }[] } };
  if (answer.result.structuredContent === undefined) throw new Error(answer.result.content[0]?.text ?? "the call answered nothing");
  return answer.result.structuredContent;
}

async function labels(url: string): Promise<string[]> {
  const snapshot = (await (await fetch(`${url}api/snapshot`)).json()) as { graph: { labels: string[] }[] };
  return snapshot.graph.flatMap((commit) => commit.labels);
}

describe("a server of one repository", () => {
  test("serves a track opened after it started: its config, its graph and its watcher see it with no restart", async () => {
    const { repo, root } = await makeTracked();
    const server = await startServer({ repo, port: 0, host: "127.0.0.1", webDir: root, intervalMs: STEP_MS });
    try {
      const operator = await call(server.url, "session_open", { worktree: root, agent: "operator" });

      await call(server.url, "track_open", { sessionId: operator["id"], name: "helper", purpose: "split the reader" });

      const config = (await (await fetch(`${server.url}api/config`)).json()) as { tracks: { name: string }[] };
      expect(config.tracks.map((track) => track.name)).toEqual(["data", "engine", "helper"]);
      const until = Date.now() + PATIENCE_MS;
      while (!(await labels(server.url)).includes("track/helper") && Date.now() < until) await delay(STEP_MS);
      expect(await labels(server.url)).toContain("track/helper");
    } finally {
      await server.close();
    }
  });
});
