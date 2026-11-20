import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { Usage, usagePathOf } from "../../core/src/usage/counts.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import type { IO } from "../src/io.ts";
import { run } from "../src/run.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) await new Promise((done) => servers.pop()?.close(done));
});

function io(cwd: string, env: NodeJS.ProcessEnv = {}): Captured {
  const captured: Captured = { lines: [], errors: [], out: (line) => captured.lines.push(line), err: (line) => captured.errors.push(line), cwd, env, columns: 120, isTTY: false };
  return captured;
}

const AT = new Date("2026-11-20T09:00:00.000Z");

describe("tally usage", () => {
  test("ranks the tools of a repository served alone from its state folder, the most called first, with what each costs", async () => {
    const { repo, root } = await makeTracked();
    const usage = await Usage.open(usagePathOf({ stateDir: repo.stateDir }), "0.7.0", AT);
    usage.count({ tool: "ledger_check", outcome: "answered", by: "none", repo: repo.name }, AT);
    usage.count({ tool: "board_get", outcome: "answered", by: "none", repo: repo.name }, AT);
    usage.count({ tool: "board_get", outcome: "refused", by: "track", repo: repo.name }, AT);
    await usage.flush();
    const captured = io(root, { TALLY_HOME: await tmpDir("tally-home-") });

    const exit = await run(["usage"], captured);

    expect(exit).toBe(0);
    const ranked = captured.lines.filter((line) => /^(board_get|ledger_check) /.test(line));
    expect(ranked[0]).toMatch(/^board_get +2 +1 +0 +0 +1 +\d+$/);
    expect(ranked[1]).toMatch(/^ledger_check +1 /);
    expect(captured.lines.join("\n")).toContain("since 2026-11-20T09:00:00.000Z");
    expect(captured.lines.join("\n")).toMatch(/never called: \d+ tools, \d+ characters/);
  });

  test("answers the ranking as JSON with --json", async () => {
    const { root } = await makeTracked();
    const captured = io(root, { TALLY_HOME: await tmpDir("tally-home-") });

    const exit = await run(["usage", "--json"], captured);

    expect(exit).toBe(0);
    expect(JSON.parse(captured.lines.join("\n"))).toMatchObject({ tools: [], never: { tools: expect.arrayContaining(["board_get"]) } });
  });

  test("asks the service when TALLY_URL is set", async () => {
    const answer = { since: AT.toISOString(), versions: [{ version: "0.7.0", since: AT.toISOString() }], tools: [{ name: "board_get", listed: true, chars: 900, calls: 7, refused: 0, cut: 0, invalid: 0, first: AT.toISOString(), last: AT.toISOString(), days: 1, by: {}, via: {}, repos: {} }], never: { tools: [], chars: 0 } };
    const server = createServer((request, response) => {
      response.writeHead(request.url === "/api/usage" ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url === "/api/usage" ? answer : { error: "not found" }));
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const captured = io("/", { TALLY_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });

    const exit = await run(["usage"], captured);

    expect(exit).toBe(0);
    expect(captured.lines.find((line) => line.startsWith("board_get "))).toMatch(/^board_get +7 +0 +0 +0 +1 +900$/);
  });

  test("costs the list as this place lists it: where no command runs, land_run is not among the tools never called", async () => {
    const { root } = await makeTracked();
    const captured = io(root, { TALLY_HOME: await tmpDir("tally-home-"), TALLY_COMMANDS: "agent" });

    await run(["usage", "--json"], captured);

    expect((JSON.parse(captured.lines.join("\n")) as { never: { tools: string[] } }).never.tools).not.toContain("land_run");
  });
});

