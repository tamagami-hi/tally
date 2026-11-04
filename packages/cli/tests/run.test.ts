import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/run.ts";
import type { IO } from "../src/io.ts";
import { Records, claimTask, listClaims, openRepo, openSession } from "../../core/src/index.ts";
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

async function withTrack() {
  const repo = await initialised();
  await writeFile(join(repo.root, "docs", "records", "ledger.json"), JSON.stringify({
    schema: 1, baseline: (await repo.head()).slice(0, 7), other: [],
    milestones: [{ id: "B2", stage: "B", name: "replay store", track: "data", weight: 11, tasks: [{ id: "1 codecs", track: "data", status: "planned", also: [] }] }],
  }));
  await sh(repo.root, ["commit", "-q", "-am", "records: milestone"]);
  const tree = join(repo.root, ".temp", "worktrees", "data");
  await sh(repo.root, ["worktree", "add", "-q", tree, "-b", "track/data", "main"]);
  await writeFile(join(repo.root, ".temp", "m.txt"), "feat(data): a\n");
  return { repo, tree };
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

  test("--help on a command prints only that command's usage lines, with no repository needed", async () => {
    const console = io("/");

    expect(await run(["task", "--help"], console)).toBe(0);

    const lines = (console.lines[0] ?? "").split("\n");
    expect(console.errors).toEqual([]);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.trim().startsWith("tally task"))).toBe(true);
    expect(lines.some((line) => line.includes("land") && line.includes("--also"))).toBe(true);
  });

  test("--help works after a verb, after other arguments, and as -h", async () => {
    const expected = io("/");
    await run(["task", "--help"], expected);

    const forms = [["task", "land", "--help"], ["task", "land", "B2", "x", "--help"], ["task", "-h"], ["--repo", "/nowhere", "task", "plan", "--help"]];
    for (const form of forms) {
      const console = io("/");
      expect(await run(form, console)).toBe(0);
      expect(console.lines).toEqual(expected.lines);
    }
  });

  test.each(["init", "import", "plans", "records", "report", "checks", "buildlog", "question", "decision", "milestone", "task", "ledger", "status", "views", "land", "serve", "mcp"])("tally %s --help has usage lines", async (command) => {
    const console = io("/");

    expect(await run([command, "--help"], console)).toBe(0);

    expect(console.lines[0]).toContain(`tally ${command}`);
  });

  test("--help on an unknown command is still a usage error", async () => {
    const console = io("/");

    expect(await run(["frobnicate", "--help"], console)).toBe(2);

    expect(console.errors[0]).toContain("tally: unknown command 'frobnicate'");
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

  test("land --milestone --task records the task at the hash it made, and the ledger stays covered", async () => {
    const { repo, tree } = await withTrack();
    await writeFile(join(tree, "a.rs"), "a");
    const console = io(repo.root);

    expect(await run(["land", "data", "--message", ".temp/m.txt", "--milestone", "B2", "--task", "1 codecs", "a.rs"], console)).toBe(0);

    const head = await sh(repo.root, ["rev-parse", "--short=7", "HEAD~1"]);
    expect(console.lines).toEqual([`data landed at ${head}`, `B2 '1 codecs': landed at ${head}`, expect.stringMatching(/^records: [0-9a-f]{7}$/)]);
    expect(await run(["ledger", "check"], console)).toBe(0);
    expect(await sh(repo.root, ["status", "--porcelain"])).toBe("");
  });

  test("land that succeeds but cannot record says so with the commit, and exits 0", async () => {
    const { repo, tree } = await withTrack();
    await writeFile(join(tree, "a.rs"), "a");
    const console = io(repo.root);

    expect(await run(["land", "data", "--message", ".temp/m.txt", "--milestone", "NOPE", "--task", "x", "a.rs"], console)).toBe(0);

    const head = await sh(repo.root, ["rev-parse", "--short=7", "HEAD"]);
    expect(console.errors).toEqual([`landed at ${head}, but recording NOPE 'x' failed: no milestone 'NOPE'; known: B2; finish it with tally task land NOPE 'x' ${head}`]);
  });

  test("land refuses a milestone without a task before anything lands", async () => {
    const { repo, tree } = await withTrack();
    await writeFile(join(tree, "a.rs"), "a");
    const before = await sh(repo.root, ["rev-parse", "main"]);
    const console = io(repo.root);

    expect(await run(["land", "data", "--message", ".temp/m.txt", "--milestone", "B2", "a.rs"], console)).toBe(2);

    expect(console.errors).toEqual(["a landing records a task from both its milestone and its task"]);
    expect(await sh(repo.root, ["rev-parse", "main"])).toBe(before);
  });

  test("task unwait clears the wait, the status stops showing it, and it needs the milestone and the task", async () => {
    const { repo } = await withTrack();
    const console = io(repo.root);
    await run(["task", "wait", "B2", "1 codecs", "the recorder"], console);

    expect(await run(["task", "unwait", "B2", "1 codecs"], console)).toBe(0);

    expect(console.lines.at(-2)).toBe("B2 '1 codecs': no longer waits for the recorder");
    expect(console.lines.at(-1)).toMatch(/^records: [0-9a-f]{7}$/);
    const status = io(repo.root);
    await run(["status", "--json"], status);
    expect((JSON.parse(status.lines[0] ?? "") as { rows: { notes: string[] }[] }).rows[0]?.notes).toEqual(["data next: 1 codecs"]);
    expect(await run(["task", "unwait", "B2"], console)).toBe(2);
    expect(await run(["task", "unwait", "B2", "1 codecs"], console)).toBe(1);
    expect(console.errors.at(-1)).toBe("'1 codecs' in B2 waits for nothing");
  });

  test("task land releases the task's claim, so the session's next claim goes through", async () => {
    const { repo, tree } = await withTrack();
    const opened = await openRepo(repo.root);
    const records = new Records(opened);
    const session = await openSession(opened, { worktree: tree, track: "data", agent: "a" });
    expect(await run(["task", "plan", "B2", "--track", "data", "2 next"], io(repo.root))).toBe(0);
    await claimTask(opened, session, await records.readLedger(), "B2", "1 codecs");
    const feature = await repo.commit("src/a.rs", "a", "feat(store): a");

    expect(await run(["task", "land", "B2", "1 codecs", feature], io(repo.root))).toBe(0);

    expect(await listClaims(opened)).toEqual([]);
    expect(await claimTask(opened, session, await records.readLedger(), "B2", "2 next")).toMatchObject({ task: "2 next" });
  });

  test("task land keeps the record and says so when the claim cannot be released", async () => {
    const { repo } = await withTrack();
    const feature = await repo.commit("src/a.rs", "a", "feat(store): a");
    busyLock("claims.json");
    const console = io(repo.root);

    expect(await run(["task", "land", "B2", "1 codecs", feature], console)).toBe(0);

    expect(console.lines[0]).toBe(`B2 '1 codecs': landed at ${feature.slice(0, 7)}`);
    expect(console.errors[0]).toMatch(/^its claim is still held: could not take the lock claims\.json/);
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
