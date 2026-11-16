import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords, opened, type Call } from "./support/connect.ts";

interface Logged {
  session: string;
  track: string;
  agent: string;
  verb: string;
  target?: string;
}

const logged = async (call: Call): Promise<Logged[]> => (await call("activity_get")).structured["events"] as Logged[];

describe("a session's opening in the activity log", () => {
  test("session_open leaves one event with the new session's id, track and agent, and no target", async () => {
    const tracked = await makeTracked();
    const { call } = await connect(keepingContextAsRecords(tracked.repo));

    const data = await opened(call, tracked.trees["data"]!, "claude");

    expect(await logged(call)).toEqual([{ at: expect.any(String), session: data, track: "data", agent: "claude", verb: "session_open" }]);
  });

  test("a refused session_open leaves none", async () => {
    const tracked = await makeTracked();
    const { call } = await connect(keepingContextAsRecords(tracked.repo));

    const refused = await call("session_open", { worktree: tracked.trees["data"]!, track: "engine", agent: "claude" });

    expect(refused.isError).toBe(true);
    expect(await logged(call)).toEqual([]);
  });

  test("none where the repository keeps no log", async () => {
    const { repo, root, trees } = await makeTracked();
    const { call } = await connect(repo);

    await opened(call, trees["data"]!);

    await expect(access(join(root, "docs/records/log"))).rejects.toThrow();
    expect(await logged(call)).toEqual([]);
  });
});
