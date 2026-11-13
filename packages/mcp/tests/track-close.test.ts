import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect } from "./support/connect.ts";

async function serving() {
  const tracked = await makeTracked();
  const { call, client } = await connect(tracked.repo);
  const operator = (await call("session_open", { worktree: tracked.root, agent: "operator" })).structured["id"] as string;
  const made = await call("track_open", { sessionId: operator, name: "helper", purpose: "split the reader" });
  return { ...tracked, call, client, operator, tree: made.structured["worktree"] as string };
}

describe("track_close", () => {
  test("answers what it deleted and where the notes went", async () => {
    const { call, operator, tree, root } = await serving();
    await writeFile(join(root, ".git", "info", "exclude"), ".temp/\nnode_modules/\n");
    await writeFile(join(tree, ".temp", "helper", "notes.md"), "kept\n");
    await (await import("node:fs/promises")).mkdir(join(tree, "node_modules"), { recursive: true });
    await writeFile(join(tree, "node_modules", "x.js"), "x");

    const closed = await call("track_close", { sessionId: operator, name: "helper" });

    expect(closed.isError).toBe(false);
    expect(closed.structured["cleaned"]).toEqual({ names: ["node_modules"], total: 1 });
    expect(closed.structured["kept"]).toBe(join(root, ".temp", "closed", "helper"));
    expect(closed.structured["name"]).toBe("helper");
  });

  test("answers no `kept` when no notes were left", async () => {
    const { call, operator } = await serving();

    const closed = await call("track_close", { sessionId: operator, name: "helper" });

    expect(closed.structured["cleaned"]).toEqual({ names: [], total: 0 });
    expect(closed.structured).not.toHaveProperty("kept");
  });

  test("says that it deletes build output and keeps notes, and no longer lists ignored files among its refusals", async () => {
    const { client } = await serving();

    const description = (await client.listTools()).tools.find((tool) => tool.name === "track_close")?.description ?? "";

    expect(description).not.toContain("ignored files in its worktree that tally did not write");
    expect(description).toContain(".temp/closed/<track>");
    expect(description).toContain("open child");
  });

  test("a session opened in the folder of a closed track is told the track was closed, when, and to open a new one", async () => {
    const { call, operator, tree } = await serving();
    await call("track_close", { sessionId: operator, name: "helper" });

    const refused = await call("session_open", { worktree: tree, agent: "sonnet" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^track helper was closed on \d{4}-\d{2}-\d{2}T[\d:.]+Z because its work had landed; new work needs a new track \(track_open\)$/);
  });

  test("a folder that never was a track keeps its own refusal", async () => {
    const { call, root } = await serving();

    const refused = await call("session_open", { worktree: join(root, ".temp", "worktrees", "never"), agent: "sonnet" });

    expect(refused.isError).toBe(true);
    expect(refused.text).not.toContain("was closed");
  });
});
