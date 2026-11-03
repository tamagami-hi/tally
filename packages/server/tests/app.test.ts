import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Records, initRecords, openRepo, type Config } from "@tally/core";
import { createApp } from "../src/app.ts";
import { Watcher } from "../src/watcher.ts";
import { makeRepo, sh } from "../../core/tests/support/repo.ts";

const config: Config = {
  schema: 1,
  name: "Test",
  mainBranch: "main",
  docsDir: "docs",
  tracks: [{ name: "data", worktree: ".temp/worktrees/data", branch: "track/data" }],
  stages: [{ id: "A", name: "the thin slice", weight: 1 }],
  commands: { test: ["true"], env: { SECRET_URL: "postgres://user:pw@host/db" }, unset: [] },
  fingerprint: { paths: ["src"], exclude: ["*.md"] },
  identity: { name: "t", email: "t@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit: false },
  locks: ["landing"],
};

async function fixture() {
  const repo = await makeRepo();
  await repo.commit(".gitignore", ".temp/\n", "chore: ignore");
  await initRecords(repo.root, config, (await repo.head()).slice(0, 7));
  await sh(repo.root, ["add", "-A"]);
  await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
  const landed = await repo.commit("src/a.rs", "a", "feat: a");
  const opened = await openRepo(repo.root);
  await new Records(opened).writeLedger({
    schema: 1, baseline: (await sh(repo.root, ["rev-parse", "--short=7", "HEAD~2"])), other: [],
    milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [
      { id: "t1", track: "data", status: "landed", commit: landed.slice(0, 7), also: [] },
      { id: "t2", track: "data", status: "planned", also: [] },
    ] }],
  });
  const web = join(repo.root, ".temp", "web");
  await mkdir(web, { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>tally</title>");
  const watcher = new Watcher(opened, { intervalMs: 50 });
  return { repo: opened, app: createApp({ repo: opened, watcher, webDir: web }), watcher, root: repo.root };
}

describe("the HTTP API", () => {
  test("answers the snapshot, the status, the ledger and the config with env values redacted", async () => {
    const { app } = await fixture();
    const snapshot = await (await app.request("/api/snapshot")).json() as { status: { name: string; overall: number }; graph: unknown[] };
    expect(snapshot.status.name).toBe("Test");
    expect(snapshot.status.overall).toBeCloseTo(0.5);
    expect(snapshot.graph.length).toBeGreaterThan(0);
    const ledger = await (await app.request("/api/ledger")).json() as { milestones: unknown[] };
    expect(ledger.milestones).toHaveLength(1);
    const redacted = await (await app.request("/api/config")).json() as { commands: { env: Record<string, string> } };
    expect(redacted.commands.env).toEqual({ SECRET_URL: "(set)" });
    expect((await app.request("/api/nothing")).status).toBe(404);
  });

  test("serves the web page at the root and for client routes", async () => {
    const { app } = await fixture();
    expect(await (await app.request("/")).text()).toContain("<title>tally</title>");
    expect(await (await app.request("/tracks")).text()).toContain("<title>tally</title>");
  });

  test("the event stream opens with a snapshot and then follows the watcher", async () => {
    const { app, watcher, root } = await fixture();
    const response = await app.request("/events");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: snapshot")) text += decoder.decode((await reader.read()).value);
    expect(text).toMatch(/event: snapshot\ndata: \{"status"/);
    watcher.start();
    await writeFile(join(root, "src", "b.rs"), "b");
    let more = "";
    const started = Date.now();
    while (!more.includes("event: snapshot") && Date.now() - started < 5000) more += decoder.decode((await reader.read()).value);
    watcher.stop();
    await reader.cancel();
    expect(more).toContain("event: snapshot");
  });
});
