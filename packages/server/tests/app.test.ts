import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Records, initRecords, openRepo, scanDocuments, writeJsonAtomic, type Config } from "@tally/core";
import { createApp, redactedConfig } from "../src/app.ts";
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

  test("redacts the landing's env values too, and leaves what it links in view", () => {
    const landing = { link: ["node_modules"], env: { CACHE_URL: "a value to hide" } };
    const shown = redactedConfig({ ...config, commands: { ...config.commands, landing } });

    expect(shown.commands.landing).toEqual({ link: ["node_modules"], env: { CACHE_URL: "(set)" } });
    expect(redactedConfig(config).commands).not.toHaveProperty("landing");
  });

  test("the graph takes a limit and says how many commits exist, as the snapshot does", async () => {
    const { app } = await fixture();
    const graph = async (query: string) => (await app.request(`/api/graph${query}`)).json() as Promise<{ commits: { hash: string }[]; total: number }>;

    const whole = await graph("");
    const one = await graph("?limit=1");
    const beyond = await graph("?limit=99999999999999999999999");
    const snapshot = await (await app.request("/api/snapshot")).json() as { graph: unknown[]; graphTotal: number };

    expect(whole.total).toBe(4);
    expect(whole.commits).toHaveLength(4);
    expect(one).toMatchObject({ total: 4, commits: [{ hash: whole.commits[0]?.hash }] });
    expect(one.commits).toHaveLength(1);
    expect(beyond.commits).toHaveLength(4);
    expect(snapshot.graphTotal).toBe(4);
  });

  test.each(["0", "-1", "abc", "1.5", "", "1e3"])("the graph refuses the limit '%s'", async (limit) => {
    const { app } = await fixture();

    const response = await app.request(`/api/graph?limit=${limit}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "limit must be a whole number above zero" });
  });

  test("lists the documents and the records, and reads one, refusing what is not a document", async () => {
    const { app, repo, root } = await fixture();
    expect(((await (await app.request("/api/docs")).json()) as { documents: unknown[] }).documents).toEqual([]);
    await mkdir(join(root, "docs", "alpha", "next"), { recursive: true });
    await writeFile(join(root, "docs", "alpha", "next", "plan.md"), "# A plan\n");
    await scanDocuments(repo);

    const index = await (await app.request("/api/docs")).json() as { documents: { path: string; kind: string; title: string }[]; records: string[] };
    const read = await app.request(`/api/docs/read?path=${encodeURIComponent("docs/alpha/next/plan.md")}`);

    expect(index.documents).toContainEqual({ path: "docs/alpha/next/plan.md", group: "alpha", kind: "next", title: "A plan" });
    expect(index.records).toContain("docs/records/ledger.json");
    expect(index.records.every((path) => path.startsWith("docs/records/"))).toBe(true);
    expect(await read.json()).toEqual({ path: "docs/alpha/next/plan.md", text: "# A plan\n" });
    expect((await app.request("/api/docs/read")).status).toBe(400);
    for (const path of ["src/a.rs", "../../etc/passwd", "docs/alpha/gone.md"]) {
      const refused = await app.request(`/api/docs/read?path=${encodeURIComponent(path)}`);
      expect(refused.status).toBe(404);
      expect(((await refused.json()) as { error: string }).error).toMatch(/not a document|does not exist/);
    }
  });

  test("lists the evidence records per milestone and serves a log in place, saying whether it still matches its hash", async () => {
    const { app, repo, root } = await fixture();
    expect(await (await app.request("/api/evidence")).json()).toEqual({ milestones: [] });
    await mkdir(join(root, ".temp", "logs"), { recursive: true });
    await writeFile(join(root, ".temp", "logs", "red.log"), "0 passed; 3 failed\n");
    const log = { path: join(root, ".temp", "logs", "red.log"), sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", bytes: 19 };
    const record = { id: "a".repeat(32), task: "t2", track: "data", agent: "a", kind: "red", command: ["cargo", "test"], cwd: root, started: "2026-11-04T00:00:00.000Z", seconds: 1, exit: 101, log };
    const gone = { ...record, id: "b".repeat(32), log: { ...log, path: join(root, ".temp", "logs", "gone.log") } };
    await writeJsonAtomic(join(repo.recordsDir, "evidence", "A1.json"), { schema: 1, milestone: "A1", records: [record, gone, { ...record, id: "c".repeat(32), log: undefined }] });
    const index = await (await app.request("/api/evidence")).json() as { milestones: { milestone: string; records: unknown[] }[] };
    expect(index.milestones.map((m) => [m.milestone, m.records.length])).toEqual([["A1", 3]]);
    expect(((await (await app.request("/api/evidence/A1")).json()) as { records: unknown[] }).records).toHaveLength(3);
    const served = await app.request(`/api/evidence/log/${"a".repeat(32)}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("x-tally-log")).toBe("changed");
    expect(await served.text()).toBe("0 passed; 3 failed\n");
    expect((await app.request(`/api/evidence/log/${"b".repeat(32)}`)).status).toBe(410);
    expect((await app.request(`/api/evidence/log/${"c".repeat(32)}`)).status).toBe(404);
    expect((await app.request("/api/evidence/log/nope")).status).toBe(404);
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
    await watcher.stop();
    await reader.cancel();
    expect(more).toContain("event: snapshot");
  });
});
