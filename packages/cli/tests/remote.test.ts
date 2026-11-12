import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { run } from "../src/run.ts";
import { serviceCli } from "../src/service-cli.ts";
import type { IO } from "../src/io.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { edit, landingFixture } from "../../core/tests/support/landing.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { startService, type Running } from "../../server/src/serve.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

const servers: Running[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

function io(cwd: string, env: NodeJS.ProcessEnv): Captured {
  const captured: Captured = { lines: [], errors: [], out: (line) => captured.lines.push(line), err: (line) => captured.errors.push(line), cwd, env, columns: 120, isTTY: false };
  return captured;
}

async function service(root: string, name: string): Promise<{ url: string; home: string }> {
  const home = await tmpDir("tally-home-");
  await addRepo(home, { root, name });
  const running = await startService({ home, workspace: join(root, ".."), port: 0, host: "127.0.0.1", webDir: await tmpDir("tally-web-"), intervalMs: 50, cli: serviceCli(run, { TALLY_HOME: home }) });
  servers.push(running);
  return { url: running.url.replace(/\/$/, ""), home };
}

describe("the tally command as a client of the service", () => {
  test("has the service do the work and prints what it printed", async () => {
    const { root } = await makeTracked();
    const { url } = await service(root, "alpha");
    const out = io(root, { TALLY_URL: url });

    const exit = await run(["task", "plan", "B2", "--track", "data", "7 through the service"], out);

    expect(exit).toBe(0);
    expect(out.lines.join("\n")).toContain("B2: planned 1 new task(s)");
    expect(await readFile(join(root, "docs/records/ledger.json"), "utf8")).toContain("7 through the service");
  });

  test("passes the service's refusal and exit status through", async () => {
    const { root } = await makeTracked();
    const { url } = await service(root, "alpha");
    const out = io(root, { TALLY_URL: url });

    const exit = await run(["task", "plan", "NOPE", "--track", "data", "a task"], out);

    expect(exit).toBe(1);
    expect(out.errors.join("\n")).toContain("NOPE");
  });

  test("works on the service's own list of repositories", async () => {
    const { root } = await makeTracked();
    const { url } = await service(root, "alpha");
    const out = io(await tmpDir("tally-cwd-"), { TALLY_URL: url });

    await run(["repo", "list"], out);

    expect(out.lines).toEqual([`alpha  ${root}  (default)`]);
  });

  test("sends a file from outside the repository along with the command", async () => {
    const { root } = await makeTracked();
    const { url } = await service(root, "alpha");
    const outside = join(await tmpDir("tally-outside-"), "body.md");
    await writeFile(outside, "The store was built.\n");
    const out = io(root, { TALLY_URL: url });

    const exit = await run(["buildlog", "append", "--group", "platform", "--milestone", "B2", "--title", "The store", "--date", "2026-11-12", "--file", outside], out);

    expect(exit).toBe(0);
    expect(await readFile(join(root, "docs/records/buildlog.json"), "utf8")).toContain("The store was built.");
  });

  test("says so and writes nothing when the service is not there", async () => {
    const { root } = await makeTracked();
    const out = io(root, { TALLY_URL: "http://127.0.0.1:9" });

    const exit = await run(["task", "plan", "B2", "--track", "data", "never planned"], out);

    expect(exit).toBe(1);
    expect(out.errors).toEqual(["tally is not reachable at http://127.0.0.1:9; start the service, or unset TALLY_URL to work on the files directly"]);
    expect(await readFile(join(root, "docs/records/ledger.json"), "utf8")).not.toContain("never planned");
  });

  test("lands through the service's queue, running the checks itself", async () => {
    const fixture = await landingFixture("true");
    const { url } = await service(fixture.root, "alpha");
    await edit(fixture.tree, "src/a.rs");
    const out = io(fixture.root, { TALLY_URL: url });

    const exit = await run(["land", "data", "--message", fixture.message, "src/a.rs"], out);

    expect(exit).toBe(0);
    expect(out.lines.at(-1)).toBe(`data landed at ${(await fixture.main()).slice(0, 7)}`);
    expect(await sh(fixture.root, ["log", "-1", "--format=%s", "main"])).toBe("feat(data): the task");
    expect((await fixture.runs()).length).toBe(1);
  });

  test("reports a landing whose checks failed, and exits 1", async () => {
    const fixture = await landingFixture("exit 5");
    const { url } = await service(fixture.root, "alpha");
    await edit(fixture.tree, "src/a.rs");
    const before = await fixture.main();
    const out = io(fixture.root, { TALLY_URL: url });

    const exit = await run(["land", "data", "--message", fixture.message, "src/a.rs"], out);

    expect(exit).toBe(1);
    expect(out.errors.join("\n")).toContain("failed its checks (exit 5)");
    expect(await fixture.main()).toBe(before);
  });
});

describe("what the service will not run for a client", () => {
  test.each(["serve", "mcp", "land"])("%s is refused, since it runs on the caller's machine", async (command) => {
    const { root } = await makeTracked();
    const { url } = await service(root, "alpha");

    const response = await fetch(`${url}/api/cli`, { method: "POST", headers: { "content-type": "application/json", "x-tally-cli": "1" }, body: JSON.stringify({ argv: [command], cwd: root }) });

    expect(await response.json()).toEqual({ exit: 2, out: [], err: [`tally ${command} runs on your own machine, not in the service`] });
  });

  test("a call without the command's header is refused", async () => {
    const { root } = await makeTracked();
    const { url } = await service(root, "alpha");

    const response = await fetch(`${url}/api/cli`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ argv: ["status"], cwd: root }) });

    expect(response.status).toBe(403);
  });
});
