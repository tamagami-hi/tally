import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listEvidence } from "../../src/records/evidence.ts";
import { importEvidence, kindOf } from "../../src/records/import-evidence.ts";
import { readPlans, scanPlans } from "../../src/records/plans.ts";
import { readReportManifest, writeReportManifest } from "../../src/records/reports.ts";
import { makeTracked, type Tracked } from "../support/tracked.ts";

async function runRecords(tracked: Tracked): Promise<string> {
  const dir = join(tracked.trees["data"]!, ".temp", "data", "B2", "task4");
  await mkdir(join(dir, "tmp"), { recursive: true });
  const cwd = tracked.trees["data"]!;
  await writeFile(join(dir, "red.json"), JSON.stringify({ command: ["cargo", "test", "--locked"], cwd, started: 1793712038.66, seconds: 3.2, exit: 101 }));
  await writeFile(join(dir, "red.log"), "test result: FAILED. 0 passed; 3 failed; 0 ignored\n");
  await writeFile(join(dir, "green-cases.json"), JSON.stringify({ command: ["cargo", "test"], cwd, elapsed_seconds: 4.4, exit: 0, head: "abc1234abc1234", file_sha256: { "src/a.rs": "00" } }));
  await writeFile(join(dir, "green-cases.log"), "test result: ok. 3 passed; 0 failed; 0 ignored\n");
  await writeFile(join(dir, "format.json"), JSON.stringify({ command: ["cargo", "fmt", "--check"], cwd, started: "2026-11-03T18:42:00.000Z", seconds: 0.1, exit: 0 }));
  await writeFile(join(dir, "notes.json"), JSON.stringify({ findings: [] }));
  await writeFile(join(dir, "tmp", "scratch.json"), JSON.stringify({ command: ["x"], cwd, started: 1, seconds: 1, exit: 0 }));
  return dir;
}

describe("indexing a track's existing run records", () => {
  test("names the kind from the file name, with the explicit kind winning", () => {
    expect(["red.json", "assertion-red.json", "b1-t2-failing.json", "core-green.json", "D1-green-cases.json", "b1-t2-passing.json", "core-clippy-green.json", "landed-fmt.json", "format-check-final.json", "landing.json", "plan-landing.json", "ledger-land.json", "coverage.json", "sweep-a03496a.json", "whitespace.json"].map(kindOf)).toEqual(["red", "red", "red", "green", "green", "green", "clippy", "fmt", "fmt", "land", "land", "land", "coverage", "sweep", "other"]);
  });

  test("indexes each run-shaped json with its sibling log hashed, once, in started order, leaving the logs in place", async () => {
    const tracked = await makeTracked();
    const { repo } = tracked;
    const dir = await runRecords(tracked);
    const first = await importEvidence(repo, dir, { milestone: "B2", task: "4 manifest" });
    expect(first).toMatchObject({ indexed: 3, skipped: 0, ignored: 1, withLogs: 2, commit: null });
    const records = await listEvidence(repo, "B2", "4 manifest");
    expect(records.map((r) => [r.kind, r.exit, r.seconds, r.track, r.agent])).toEqual([["red", 101, 3.2, "data", "import"], ["fmt", 0, 0.1, "data", "import"], ["green", 0, 4.4, "data", "import"]]);
    expect(records[0]?.started).toBe(new Date(1793712038.66 * 1000).toISOString());
    expect(records[0]?.log).toMatchObject({ path: join(dir, "red.log"), bytes: 51 });
    expect(records[0]?.summary).toEqual({ passed: 0, failed: 3, ignored: 0 });
    expect(records[0]?.note).toBe("indexed from .temp/worktrees/data/.temp/data/B2/task4/red.json");
    expect(records[1]?.log).toBeUndefined();
    expect(records[2]?.summary).toEqual({ passed: 3, failed: 0, ignored: 0, head: "abc1234abc1234" });
    expect(Number.isNaN(Date.parse(records[2]!.started))).toBe(false);
    expect(records[2]?.note).toContain("started from the record file's mtime");
    expect(records.every((r) => /^[0-9a-f]{32}$/.test(r.id))).toBe(true);
    const again = await importEvidence(repo, dir, { milestone: "B2", task: "4 manifest" });
    expect(again).toMatchObject({ indexed: 0, skipped: 3 });
    expect((await listEvidence(repo, "B2", "4 manifest")).length).toBe(3);
    const forced = await importEvidence(repo, join(dir), { milestone: "B2", task: "5 transcoder", kind: "other" });
    expect(forced.indexed).toBe(3);
    expect((await listEvidence(repo, "B2", "5 transcoder")).map((r) => r.kind)).toEqual(["other", "other", "other"]);
    expect(await readFile(join(dir, "red.log"), "utf8")).toContain("FAILED");
    await writeFile(join(dir, "..", "top.json"), JSON.stringify({ command: ["x"], cwd: tracked.trees["data"]!, started: 5, seconds: 1, exit: 0 }));
    const flat = await importEvidence(repo, join(dir, ".."), { milestone: "B2", task: "done", flat: true });
    expect(flat).toMatchObject({ indexed: 1, ignored: 0 });
    expect((await listEvidence(repo, "B2", "done")).map((r) => r.note)).toEqual(["indexed from .temp/worktrees/data/.temp/data/B2/top.json"]);
    await expect(importEvidence(repo, dir, { milestone: "B2", task: "nope" })).rejects.toThrow("'nope' is not planned in B2");
    await expect(importEvidence(repo, join(dir, "missing"), { milestone: "B2", task: "4 manifest" })).rejects.toThrow(/cannot be read/);
  });
});

describe("indexing a red that was not one", () => {
  test("a run named red with no failed test is indexed as other, keeping where it came from", async () => {
    const tracked = await makeTracked();
    const cwd = tracked.trees["data"]!;
    const dir = join(cwd, ".temp", "data", "B2", "false-red");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "red.json"), JSON.stringify({ command: ["cargo", "test"], cwd, started: 1793712038, seconds: 0.03, exit: 1 }));
    await writeFile(join(dir, "red.log"), "error: unexpected argument\n");

    await importEvidence(tracked.repo, dir, { milestone: "B2", task: "4 manifest" });

    const [record] = await listEvidence(tracked.repo, "B2", "4 manifest");
    expect(record?.kind).toBe("other");
    expect(record?.note).toBe("recorded as other, not red: it exited 1 with no failed test, such as a compile or usage error; indexed from .temp/worktrees/data/.temp/data/B2/false-red/red.json");
  });
});

describe("the plans record", () => {
  test("scan lists every plan under next/ and completed/ with its group, title and status line", async () => {
    const { repo, root } = await makeTracked();
    await mkdir(join(root, "docs", "market_data", "next"), { recursive: true });
    await mkdir(join(root, "docs", "engine", "completed", "sim"), { recursive: true });
    await mkdir(join(root, "docs", "plans"), { recursive: true });
    await writeFile(join(root, "docs", "market_data", "next", "store.md"), "# The store: a plan\n\n**Status: proposed 2026-10-28.**\n\n## 1. What\n");
    await writeFile(join(root, "docs", "market_data", "next", "notes.md"), "# Notes\n\nNo status here.\n");
    await writeFile(join(root, "docs", "engine", "completed", "sim", "simulator.md"), "# The simulator\n\n**Status: built 2026-11-01 in A4.**\n");
    await writeFile(join(root, "docs", "plans", "README.md"), "# plans\n");
    expect(await readPlans(repo)).toEqual({ schema: 1, plans: [] });
    const done = await scanPlans(repo);
    expect(done).toMatchObject({ next: 2, completed: 1, commit: null });
    const file = await readPlans(repo);
    expect(file.plans).toEqual([
      { path: "docs/engine/completed/sim/simulator.md", group: "engine", status: "completed", title: "The simulator", statusLine: "**Status: built 2026-11-01 in A4.**" },
      { path: "docs/market_data/next/notes.md", group: "market_data", status: "next", title: "Notes", statusLine: "" },
      { path: "docs/market_data/next/store.md", group: "market_data", status: "next", title: "The store: a plan", statusLine: "**Status: proposed 2026-10-28.**" },
    ]);
    expect(await scanPlans(repo)).toMatchObject({ next: 2, completed: 1 });
  });
});

describe("report manifests", () => {
  test("cite evidence records by id, hash every bundled file, and refuse what is not there", async () => {
    const tracked = await makeTracked();
    const { repo, root } = tracked;
    const dir = await runRecords(tracked);
    await importEvidence(repo, dir, { milestone: "B2", task: "4 manifest" });
    const folder = join(root, "docs", "market_data", "reports", "2026-11-03");
    await mkdir(join(folder, "b4", "checks"), { recursive: true });
    await writeFile(join(folder, "b4.md"), "# B4 close\n");
    await writeFile(join(folder, "b4", "README.md"), "index\n");
    await writeFile(join(folder, "b4", "checks", "fmt.log"), "");
    const input = { date: "2026-11-03", name: "b4", group: "market_data", narrative: "docs/market_data/reports/2026-11-03/b4.md", bundle: "docs/market_data/reports/2026-11-03/b4", fingerprint: "58b59d3", evidence: [{ milestone: "B2", task: "4 manifest" }], decisions: ["SID-3"], questions: [36] };
    const { manifest, path, commit } = await writeReportManifest(repo, input);
    expect(commit).toBeNull();
    expect(path).toBe(join(repo.recordsDir, "reports", "2026-11-03", "b4.json"));
    expect(manifest.cites.evidence).toHaveLength(3);
    expect(manifest.cites).toMatchObject({ decisions: ["SID-3"], questions: [36] });
    expect(manifest.bundled).toEqual([
      { path: "docs/market_data/reports/2026-11-03/b4/README.md", sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: 6 },
      { path: "docs/market_data/reports/2026-11-03/b4/checks/fmt.log", sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: 0 },
    ]);
    expect(await readReportManifest(repo, "2026-11-03", "b4")).toEqual(manifest);
    await expect(writeReportManifest(repo, { ...input, narrative: "docs/nowhere.md" })).rejects.toThrow("the narrative docs/nowhere.md does not exist");
    await expect(writeReportManifest(repo, { ...input, bundle: "RULES.md" })).rejects.toThrow(/inside docs/);
    await expect(writeReportManifest(repo, { ...input, evidence: [{ milestone: "B2", task: "nope" }] })).rejects.toThrow("'nope' is not planned in B2");
    await expect(writeReportManifest(repo, { ...input, date: "yesterday" })).rejects.toThrow(/date must be YYYY-MM-DD/);
  });
});
