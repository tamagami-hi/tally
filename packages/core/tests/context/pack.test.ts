import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { contextPack } from "../../src/context/pack.ts";
import { listDocs, readDoc, searchDocs } from "../../src/docs/files.ts";
import { writeHandoff } from "../../src/records/handoffs.ts";
import { Records } from "../../src/store/records.ts";
import { claimTask } from "../../src/state/claims.ts";
import { openSession } from "../../src/state/sessions.ts";
import { makeTracked } from "../support/tracked.ts";

describe("context packs", () => {
  test("the project pack carries the rules, the milestones, the sessions and the claims", async () => {
    const { repo, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "claude" });
    await claimTask(repo, data, await new Records(repo).readLedger(), "B2", "4 manifest");
    const pack = await contextPack(repo, { level: "project" });
    expect(pack.text).toContain("# Test: project context");
    expect(pack.text).toContain("Milestones: B2 1/4.");
    expect(pack.text).toContain("Sessions: claude on data.");
    expect(pack.text).toContain("## RULES.md");
    expect(pack.text).toContain("(no CLAUDE.md)");
    expect(pack.parts["claims"]).toHaveLength(1);
  });

  test("the track and task packs carry the tasks' states, the hand-off and the evidence", async () => {
    const { repo, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "claude" });
    await writeHandoff(repo, data, { task: "4 manifest", lines: ["RED is in", "next: publication"] });
    const track = await contextPack(repo, { level: "track", track: "data" });
    expect(track.text).toContain("- B2 / 4 manifest: planned");
    expect(track.text).toContain("- B2 / done: landed abc1234");
    expect(track.text).not.toContain("T9 store");
    expect(track.text).toContain("next: publication");
    const task = await contextPack(repo, { level: "task", milestone: "B2", task: "T9 store" });
    expect(task.text).toContain("waits for B2");
    expect(task.text).toContain("(none yet)");
    await expect(contextPack(repo, { level: "task", milestone: "B2" })).rejects.toThrow("needs the milestone and the task");
    await expect(contextPack(repo, { level: "track", track: "nope" })).rejects.toThrow("no track 'nope'");
    const milestone = await contextPack(repo, { level: "milestone", milestone: "B2" });
    expect(milestone.text).toContain("evidence records: 0");
  });
});

describe("the docs reader", () => {
  test("lists and reads only the documents, refusing traversal and symlinks out", async () => {
    const { repo, root } = await makeTracked();
    await mkdir(join(root, "docs", "plans"), { recursive: true });
    await writeFile(join(root, "docs", "plans", "a.md"), "# Plan A\n\nthe store keys columns by id\n");
    await writeFile(join(root, "docs", "plans", "secret.txt"), "not a doc");
    await writeFile(join(root, "outside.md"), "outside");
    await symlink(join(root, "outside.md"), join(root, "docs", "link.md"));
    const docs = await listDocs(repo);
    expect(docs).toContain("RULES.md");
    expect(docs).toContain("docs/plans/a.md");
    expect(docs).toContain("docs/records/ledger.json");
    expect(docs).not.toContain("docs/plans/secret.txt");
    expect((await readDoc(repo, "docs/plans/a.md")).text).toContain("# Plan A");
    await expect(readDoc(repo, "../etc/passwd")).rejects.toThrow(/is not a document/);
    await expect(readDoc(repo, "docs/plans/secret.txt")).rejects.toThrow(/is not a document/);
    await expect(readDoc(repo, "docs/missing.md")).rejects.toThrow("does not exist");
    await expect(readDoc(repo, "docs/link.md")).rejects.toThrow("is a link to outside.md, which is not a document");
    const hits = await searchDocs(repo, "KEYS columns");
    expect(hits).toEqual([{ path: "docs/plans/a.md", line: 3, text: "the store keys columns by id" }]);
    await expect(searchDocs(repo, "  ")).rejects.toThrow("needs a query");
  });
});
