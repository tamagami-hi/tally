import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

async function serving() {
  const { repo, root } = await makeTracked();
  const { call } = await connect(repo);
  return { call, root, operator: await opened(call, root, "operator") };
}

describe("track_open and track_edit answer the tracks whose declared paths overlap", () => {
  test("track_open names an open track that shares a path, and opens all the same", async () => {
    const { call, operator } = await serving();
    await call("track_open", { sessionId: operator, name: "docs", purpose: "the docs", paths: ["docs"] });

    const api = await call("track_open", { sessionId: operator, name: "api", purpose: "the API", paths: ["docs/api", "src/api"] });

    expect(api.isError).toBe(false);
    expect(api.structured["declared"]).toEqual([{ track: "docs", shared: ["docs/api"] }]);
  });

  test("track_edit widens a track, and answers its paths and the overlaps", async () => {
    const { call, operator } = await serving();
    await call("track_open", { sessionId: operator, name: "docs", purpose: "the docs", paths: ["docs"] });
    await call("track_open", { sessionId: operator, name: "api", purpose: "the API", paths: ["src/api"] });

    const edited = await call("track_edit", { sessionId: operator, name: "api", addPaths: ["docs/api"] });

    expect(edited.isError).toBe(false);
    expect(edited.structured).toMatchObject({ name: "api", paths: ["src/api", "docs/api"], declared: [{ track: "docs", shared: ["docs/api"] }] });
  });
});

describe("track_close with endSessions", () => {
  test("ends the sessions on the track that hold no claim, and closes it", async () => {
    const { call, operator, root } = await serving();
    await call("track_open", { sessionId: operator, name: "docs", purpose: "the docs" });
    await opened(call, join(root, ".temp/worktrees/docs"), "claude");

    const refused = await call("track_close", { sessionId: operator, name: "docs" });
    const closed = await call("track_close", { sessionId: operator, name: "docs", endSessions: true });

    expect(refused.text).toContain("endSessions");
    expect(closed.isError).toBe(false);
    expect((closed.structured["ended"] as { agent: string }[]).map((one) => one.agent)).toEqual(["claude"]);
  });
});
