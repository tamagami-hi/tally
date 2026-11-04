import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/run.ts";
import type { IO } from "../src/io.ts";
import { busyLock } from "../../core/tests/support/busy.ts";
import { makeRepo, sh } from "../../core/tests/support/repo.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

function io(cwd: string): Captured {
  const captured: Captured = {
    lines: [],
    errors: [],
    out: (line) => captured.lines.push(line),
    err: (line) => captured.errors.push(line),
    cwd,
    env: {},
    columns: 120,
    isTTY: false,
  };
  return captured;
}

const config = {
  schema: 1,
  name: "Test",
  tracks: [{ name: "data", worktree: ".temp/worktrees/data", branch: "track/data" }],
  stages: [{ id: "A", name: "the thin slice", weight: 32 }, { id: "B", name: "widen every part", weight: 52 }, { id: "C", name: "waits on the operator", weight: 16 }],
  commands: { test: ["true"] },
  fingerprint: { paths: ["src"], exclude: ["*.md"] },
  identity: { name: "operator", email: "operator@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit: true },
};

async function initialised() {
  const repo = await makeRepo();
  await mkdir(join(repo.root, ".temp"), { recursive: true });
  await writeFile(join(repo.root, ".temp", "config.json"), JSON.stringify(config));
  await writeFile(join(repo.root, ".gitignore"), ".temp/\n");
  await sh(repo.root, ["add", ".gitignore"]);
  await sh(repo.root, ["commit", "-q", "-m", "chore: ignore .temp"]);
  const console = io(repo.root);
  expect(await run(["init", "--config", ".temp/config.json"], console)).toBe(0);
  expect(console.lines[0]).toMatch(/^initialised .*docs\/records for Test at baseline [0-9a-f]{7}$/);
  await sh(repo.root, ["add", "-A"]);
  await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
  return repo;
}

describe("the command line", () => {
  test("prints usage without a command and refuses an unknown one", async () => {
    const console = io("/");
    expect(await run([], console)).toBe(2);
    expect(console.lines[0]).toContain("tally: the tracking harness");
    const other = io("/");
    expect(await run(["--repo", "/nowhere", "frobnicate"], other)).toBe(1);
    expect(other.errors[0]).toMatch(/config\.json does not exist/);
  });

  test("names the missing repository when no records are above the folder", async () => {
    const console = io(await (await makeRepo()).root);
    expect(await run(["status"], console)).toBe(2);
    expect(console.errors[0]).toMatch(/no docs\/records\/config\.json above/);
  });

  test("plans, lands, waits and checks, committing the records each time", async () => {
    const repo = await initialised();
    await writeFile(join(repo.root, "docs", "records", "ledger.json"), JSON.stringify({
      schema: 1, baseline: (await repo.head()).slice(0, 7), other: [],
      milestones: [{ id: "B2", stage: "B", name: "replay store", track: "data", weight: 11, tasks: [] }],
    }));
    await sh(repo.root, ["commit", "-q", "-am", "records: milestone"]);
    const feature = await repo.commit("src/a.rs", "a", "feat(store): a");
    const console = io(repo.root);
    expect(await run(["task", "plan", "B2", "--track", "data", "B2 data close", "1 codecs"], console)).toBe(0);
    expect(console.lines).toEqual(["B2: planned 2 new task(s): B2 data close, 1 codecs", expect.stringMatching(/^records: [0-9a-f]{7}$/)]);
    expect(await run(["ledger", "check"], console)).toBe(1);
    expect(console.lines.at(-1)).toMatch(/feat\(store\): a$/);
    expect(await run(["task", "land", "B2", "1 codecs", feature], console)).toBe(0);
    expect(console.lines.at(-2)).toBe(`B2 '1 codecs': landed at ${feature.slice(0, 7)}`);
    expect(await run(["task", "wait", "B2", "B2 data close", "product"], console)).toBe(0);
    expect(await run(["ledger", "check"], console)).toBe(0);
    expect(console.lines.at(-1)).toBe("the ledger covers every commit on main");
    expect(await sh(repo.root, ["log", "--format=%s", "-4"])).toBe([
      "records: B2 'B2 data close': waits for product",
      `records: B2 '1 codecs': landed at ${feature.slice(0, 7)}`,
      "records: B2: planned 2 new task(s): B2 data close, 1 codecs",
      "feat(store): a",
    ].join("\n"));
    expect(await sh(repo.root, ["status", "--porcelain"])).toBe("");
  });

  test("imports a board, reports the status as markdown and refuses a second import without --force", async () => {
    const repo = await initialised();
    const board = readFileSync(new URL("../../core/tests/fixtures/board.json", import.meta.url), "utf8");
    await writeFile(join(repo.root, ".temp", "board.json"), board);
    const console = io(repo.root);
    expect(await run(["import", "board", ".temp/board.json"], console)).toBe(0);
    expect(console.lines[0]).toMatch(/^imported .*board\.json: 14 milestones, 52 tasks, 6 other commits, 3 stages$/);
    expect(await run(["import", "board", ".temp/board.json"], console)).toBe(1);
    expect(console.errors[0]).toMatch(/already holds 14 milestones; pass --force/);
    const status = io(repo.root);
    await run(["status", "--markdown"], status);
    expect(status.lines[0]).toContain("# Test status");
    expect(status.lines[0]).toContain("| **B** | B1 matrix reader | data | built | 100% |");
    expect(status.lines[0]).toContain("Ledger needs attention");
  });

  test("records commit says the lock stopped it rather than that no records were waiting", async () => {
    const repo = await initialised();
    await writeFile(join(repo.root, "docs", "records", "ledger.json"), JSON.stringify({ schema: 1, baseline: (await repo.head()).slice(0, 7), other: [], milestones: [] }));
    busyLock("landing.lock");
    const console = io(repo.root);

    expect(await run(["records", "commit"], console)).toBe(1);

    expect(console.lines).toEqual([]);
    expect(console.errors[0]).toMatch(/landing\.lock .*nothing was changed/);
  });

  test("the landing refuses in land.py's words through the command line", async () => {
    const repo = await initialised();
    const console = io(repo.root);
    expect(await run(["land", "data", "/abs/file", "--message", "m.txt"], console)).toBe(1);
    expect(console.errors[0]).toBe("file must be relative to the worktree: /abs/file");
    expect(await run(["land", "nope"], console)).toBe(1);
    expect(console.errors[1]).toBe("no track 'nope'; known: data");
  });
});
