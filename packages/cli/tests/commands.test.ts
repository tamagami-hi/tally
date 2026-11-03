import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/run.ts";
import type { IO } from "../src/io.ts";
import { makeRepo, sh } from "../../core/tests/support/repo.ts";
import { CHECKS, LOG } from "../../core/tests/fixtures/records.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

function io(cwd: string, extra: Partial<IO> = {}): Captured {
  const captured: Captured = {
    lines: [],
    errors: [],
    out: (line) => captured.lines.push(line),
    err: (line) => captured.errors.push(line),
    cwd,
    env: {},
    columns: 120,
    isTTY: false,
    ...extra,
  };
  return captured;
}

async function fresh() {
  const repo = await makeRepo();
  await sh(repo.root, ["config", "user.name", "operator"]);
  await sh(repo.root, ["config", "user.email", "operator@example.com"]);
  await repo.commit(".gitignore", ".temp/\n", "chore: ignore scratch");
  return repo;
}

describe("init from the template", () => {
  test("writes a config from git's identity and the baseline from HEAD", async () => {
    const repo = await fresh();
    const console = io(repo.root);
    expect(await run(["init", "--name", "Tally"], console)).toBe(0);
    const config = JSON.parse(await readFile(join(repo.root, "docs", "records", "config.json"), "utf8")) as { identity: unknown; stages: unknown[] };
    expect(config.identity).toEqual({ name: "operator", email: "operator@example.com" });
    expect(config.stages).toEqual([]);
    expect(console.lines[0]).toContain(`at baseline ${(await repo.head()).slice(0, 7)}`);
    expect(await run(["init", "--name", "Tally"], console)).toBe(1);
    expect(console.errors[0]).toMatch(/already exists/);
  });

  test("needs a name or a config", async () => {
    const repo = await fresh();
    const console = io(repo.root);
    expect(await run(["init"], console)).toBe(2);
    expect(console.errors[0]).toBe("init needs --name or --config");
  });
});

describe("status and task through the command line", () => {
  test("status answers JSON and a coloured terminal, and task other and an unknown verb", async () => {
    const repo = await fresh();
    await run(["init", "--name", "Tally"], io(repo.root));
    await sh(repo.root, ["add", "-A"]);
    await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
    const note = await repo.commit("docs/x.md", "x", "docs: x");
    const json = io(repo.root);
    expect(await run(["status", "--json"], json)).toBe(1);
    const status = JSON.parse(json.lines[0] ?? "") as { name: string; problems: string[] };
    expect(status.name).toBe("Tally");
    expect(status.problems[0]).toMatch(/docs: x/);
    const terminal = io(repo.root, { isTTY: true });
    expect(await run(["status"], terminal)).toBe(1);
    expect(terminal.lines[0]).toContain("\u001b[");
    const console = io(repo.root);
    expect(await run(["task", "other", note, "a note"], console)).toBe(0);
    expect(console.lines[0]).toBe(`${note.slice(0, 7)}: recorded as 'a note'`);
    expect(await run(["status", "--no-color"], io(repo.root, { isTTY: true }))).toBe(0);
    expect(await run(["task", "frob"], console)).toBe(2);
    expect(console.errors[0]).toMatch(/unknown verb 'frob'/);
    expect(await run(["ledger", "frob"], console)).toBe(2);
    expect(await run(["import", "frob", "x"], console)).toBe(2);
    expect(await run(["task", "plan", "M", "x"], console)).toBe(2);
    expect(console.errors.at(-1)).toBe("plan needs --track");
  });

  test("milestone add makes a milestone that plan can then fill, and refuses what it cannot", async () => {
    const repo = await fresh();
    await writeFile(join(repo.root, "c.json"), JSON.stringify({
      schema: 1, name: "T", tracks: [], stages: [{ id: "B", name: "the build", weight: 100 }], commands: { test: ["true"] },
      fingerprint: { paths: ["src"] }, identity: { name: "o", email: "o@example.com" }, records: { commit: false },
    }));
    await run(["init", "--config", "c.json"], io(repo.root));
    const console = io(repo.root);
    expect(await run(["milestone", "add", "P2", "--stage", "B", "--name", "server", "--track", "main", "--weight", "20"], console)).toBe(0);
    expect(console.lines[0]).toBe("P2: added to stage B");
    expect(await run(["task", "plan", "P2", "--track", "main", "SSE", "P2 close"], console)).toBe(0);
    expect(console.lines[1]).toBe("P2: planned 2 new task(s): SSE, P2 close");
    expect(await run(["milestone", "add", "P3", "--stage", "Z", "--name", "x", "--track", "main", "--weight", "1"], console)).toBe(1);
    expect(console.errors[0]).toBe("no stage 'Z'; known: B");
    expect(await run(["milestone", "add", "P3", "--stage", "B"], console)).toBe(2);
    expect(await run(["milestone", "drop", "P3"], console)).toBe(2);
  });

  test("a bad flag is a usage error with exit 2", async () => {
    const repo = await fresh();
    await run(["init", "--name", "Tally"], io(repo.root));
    const console = io(repo.root);
    expect(await run(["status", "--bogus"], console)).toBe(2);
    expect(console.errors[0]).toMatch(/bogus/);
    await writeFile(join(repo.root, "m.txt"), "msg");
    expect(await run(["land", "data", "--message", "m.txt", "f"], console)).toBe(1);
    expect(console.errors[1]).toBe("no track 'data'; known: ");
  });
});

describe("checks and build logs through the command line", () => {
  test("import checks, fingerprint's exit code, render, set, and the build log verbs", async () => {
    const repo = await fresh();
    await run(["init", "--name", "Tally"], io(repo.root));
    await sh(repo.root, ["add", "-A"]);
    await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
    await mkdir(join(repo.root, "src"), { recursive: true });
    const code = await repo.commit("src/a.rs", "a", "feat: a");
    await writeFile(join(repo.root, "checks.md"), CHECKS);
    const console = io(repo.root);
    expect(await run(["checks", "fingerprint"], console)).toBe(1);
    expect(console.lines[0]).toBe(`record none; main ${code.slice(0, 7)}; the record is stale`);
    expect(await run(["import", "checks", "checks.md"], console)).toBe(0);
    expect(console.lines[1]).toMatch(/^imported the code-check record at 58b59d3 from .*checks\.md: 2 checks, 2 suites, 2 modules with 4 files$/);
    expect(console.lines[2]).toMatch(/^records: [0-9a-f]{7}$/);
    expect(await run(["checks", "fingerprint"], console)).toBe(1);
    expect(await run(["checks", "render"], console)).toBe(0);
    expect(`${console.lines.at(-1)}\n`).toBe(CHECKS);
    const current = io(repo.root);
    expect(await run(["checks", "get"], current)).toBe(0);
    const record = JSON.parse(current.lines[0] ?? "") as { fingerprint: string };
    await writeFile(join(repo.root, "set.json"), JSON.stringify({ ...record, fingerprint: code.slice(0, 7) }));
    expect(await run(["checks", "set", "--file", "set.json"], current)).toBe(0);
    expect(current.lines[1]).toBe(`checks set at ${code.slice(0, 7)}`);
    expect(await run(["checks", "fingerprint"], current)).toBe(0);
    expect(await run(["checks", "set"], current)).toBe(2);
    expect(await run(["checks", "frob"], current)).toBe(2);
    await writeFile(join(repo.root, "log.md"), LOG);
    const log = io(repo.root);
    expect(await run(["import", "buildlog", "log.md"], log)).toBe(2);
    expect(await run(["import", "buildlog", "log.md", "--group", "market_data"], log)).toBe(0);
    expect(log.lines[0]).toMatch(/^imported 3 build log sections of market_data from /);
    expect(await run(["buildlog", "render", "--group", "market_data"], log)).toBe(0);
    expect(`${log.lines.at(-1)}\n`).toBe(LOG);
    await writeFile(join(repo.root, "body.md"), "**Built:** the store.\n");
    expect(await run(["buildlog", "append", "--group", "market_data", "--milestone", "B2", "--title", "The replay store", "--date", "2026-11-05", "--file", "body.md", "--commit", "abc1234"], log)).toBe(0);
    expect(log.lines.at(-2)).toBe("market_data build log: B2. The replay store, 2026-11-05");
    expect(await run(["buildlog", "append", "--group", "market_data"], log)).toBe(2);
    expect(await run(["buildlog", "render"], log)).toBe(2);
    expect(await run(["buildlog", "frob"], log)).toBe(2);
  });
});
