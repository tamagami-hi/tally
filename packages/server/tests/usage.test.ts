import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { startServer, startService } from "../src/serve.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

async function callTool(url: string, name: string, args: Record<string, unknown> = {}): Promise<void> {
  const response = await fetch(`${url}mcp`, { method: "POST", headers: HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  await response.text();
}

interface Ranked {
  name: string;
  calls: number;
  invalid: number;
  repos: Record<string, number>;
  chars: number;
}

const usageAt = async (url: string): Promise<{ tools: Ranked[]; never: { tools: string[]; chars: number }; versions: { version: string }[] }> => (await fetch(`${url}api/usage`)).json() as never;

describe("the count of what is called, in the service", () => {
  test("answers the ranking at /api/usage, and keeps it in the home folder across a restart", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });
    const start = () => startService({ home, workspace: root, port: 0, host: "127.0.0.1", webDir: root, intervalMs: 50 });
    const first = await start();
    await callTool(first.url, "board_get");
    await callTool(first.url, "board_get", { nonsense: true });
    const seen = await usageAt(first.url);
    await first.close();
    await access(join(home, "usage.json"));

    const second = await start();
    await callTool(second.url, "ledger_check");
    const again = await usageAt(second.url);
    await second.close();

    expect(seen.tools).toEqual([expect.objectContaining({ name: "board_get", calls: 1, invalid: 1, repos: { alpha: 1 } })]);
    expect(seen.tools[0]?.chars).toBeGreaterThan(100);
    expect(seen.never.tools).toContain("ledger_check");
    expect(again.tools.map((tool) => [tool.name, tool.calls])).toEqual([["board_get", 1], ["ledger_check", 1]]);
  });

  test("a server of one repository keeps the count in that repository's state folder", async () => {
    const { repo } = await makeTracked();
    const running = await startServer({ repo, port: 0, host: "127.0.0.1", webDir: repo.root, intervalMs: 50 });

    await callTool(running.url, "board_get");
    const seen = await usageAt(running.url);
    await running.close();

    expect(seen.tools.map((tool) => tool.name)).toEqual(["board_get"]);
    await access(join(repo.stateDir, "usage.json"));
  });
});
