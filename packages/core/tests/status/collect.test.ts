import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { collect } from "../../src/status/collect.ts";
import { renderMarkdown } from "../../src/status/markdown.ts";
import { renderTerminal } from "../../src/status/terminal.ts";
import { Paint } from "../../src/status/table.ts";
import { Records, initRecords, openRepo } from "../../src/store/records.ts";
import type { Config } from "../../src/schema/config.ts";
import { makeRepo, sh } from "../support/repo.ts";

const config: Config = {
  schema: 1,
  name: "Test",
  mainBranch: "main",
  docsDir: "docs",
  tracks: [{ name: "data", worktree: ".temp/worktrees/data", branch: "track/data" }],
  stages: [{ id: "A", name: "the thin slice", weight: 1 }],
  commands: { test: ["true"], env: {}, unset: [] },
  fingerprint: { paths: ["src"], exclude: ["*.md"] },
  identity: { name: "t", email: "t@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit: false },
  locks: ["landing"],
};

async function fixture() {
  const repo = await makeRepo();
  const baseline = await repo.head();
  await initRecords(repo.root, config, baseline.slice(0, 7));
  await mkdir(join(repo.root, "docs", "engine"), { recursive: true });
  await writeFile(join(repo.root, "docs", "engine", "questions.md"), "| 36 | q |\n| 37 | q |\nthe next is 38\n");
  await sh(repo.root, ["add", "-A"]);
  await sh(repo.root, ["commit", "-q", "-m", "records: fixture"]);
  await repo.commit(".gitignore", ".temp/\n", "records: ignore scratch");
  const landed = await repo.commit("src/a.rs", "a", "feat: a");
  await repo.commit("src/b.rs", "b", "feat: b");
  const tree = join(repo.root, ".temp", "worktrees", "data");
  await sh(repo.root, ["worktree", "add", "-q", tree, "-b", "track/data", "main"]);
  await writeFile(join(tree, "open.rs"), "x");
  const records = new Records(await openRepo(repo.root));
  await records.writeLedger({
    schema: 1,
    baseline: baseline.slice(0, 7),
    milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [
      { id: "t1", track: "data", status: "landed", commit: landed.slice(0, 7), also: [] },
      { id: "t2", track: "data", status: "planned", also: [] },
    ] }],
    other: [],
  });
  return { repo, records, landed };
}

describe("collecting the status", () => {
  test("reads the ledger, git and the questions into one picture", async () => {
    const { repo, records } = await fixture();
    const status = await collect(records.repo, await records.readLedger());
    expect(status.name).toBe("Test");
    expect(status.overall).toBeCloseTo(0.5);
    expect(status.rows[0]!.notes).toEqual(["data next: t2"]);
    expect(status.problems).toEqual([expect.stringMatching(/^commits on main not in the ledger .*feat: b$/)]);
    expect(status.questions).toEqual(["36 (engine)", "37 (engine)"]);
    expect(status.nextRow).toBe(38);
    expect(status.main).toMatch(/^[0-9a-f]{7} feat: b$/);
    expect(status.origin).toBeNull();
    expect(status.unpushed).toBe(0);
    const tracks = status.tracks.map((t) => [t.track, t.dirty, t.behind, t.worktree]);
    expect(tracks).toEqual([["main", 1, 0, true], ["data", 1, 0, true]]);
    expect(status.tracks[0]!.files).toEqual([{ status: "M", path: "docs/records/ledger.json", add: expect.any(String), del: expect.any(String) }]);
    expect(status.tracks[1]!.path).toBe(".temp/worktrees/data");
    expect(status.tracks[0]!.path).toBe(".");
  });

  test("renders the terminal tables and the markdown without colour", async () => {
    const { records } = await fixture();
    const status = await collect(records.repo, await records.readLedger());
    const text = renderTerminal(status, new Paint(false), 110);
    expect(text).toContain("Test build status");
    expect(text).toContain("A1  reader");
    expect(text).toContain("1 of 2 tasks in");
    expect(text).toContain("Ledger needs attention:");
    expect(text).toContain("Open questions: 36 (engine), 37 (engine) · next row 38");
    const markdown = renderMarkdown(status);
    expect(markdown).toContain("| **A** | A1 reader | data | 1/2 in; data next: t2 | 50% |");
    expect(markdown).toContain("**Stage A total**");
    expect(markdown).toContain("**Ledger needs attention:**");
  });
});
