import { describe, expect, test } from "vitest";
import { trialling } from "../../core/tests/support/trialling.ts";
import { connect, opened } from "./support/connect.ts";

async function serving() {
  const made = await trialling();
  const { call } = await connect(made.repo);
  return { ...made, call, operatorId: await opened(call, made.root, "operator"), dataId: await opened(call, made.trees["data"]!, "claude") };
}

describe("trial_start and trial_end", () => {
  test("an operator session starts a trial, track_list answers it, and trial_end removes it", async () => {
    const made = await serving();

    const started = await made.call("trial_start", { sessionId: made.operatorId, name: "both", tracks: ["engine", "data"] });
    const listed = (await made.call("track_list", {})).structured;
    const ended = await made.call("trial_end", { sessionId: made.operatorId, name: "both" });

    expect(started.isError, started.text).toBe(false);
    expect(started.structured).toMatchObject({ name: "both", worktree: made.folder("both"), tracks: [{ name: "engine", commits: 1 }, { name: "data", commits: 2 }] });
    expect(listed["trials"]).toEqual([expect.objectContaining({ name: "both", branch: "trial/both", head: started.structured["head"] })]);
    expect(ended.structured).toEqual({ name: "both", removed: { worktree: made.folder("both"), branch: "trial/both" } });
    expect((await made.call("track_list", {})).structured).not.toHaveProperty("trials");
  });

  test("a track session is refused by both", async () => {
    const made = await serving();

    expect((await made.call("trial_start", { sessionId: made.dataId, name: "both", tracks: ["data"] })).text).toContain("only an operator session starts a trial");
    expect((await made.call("trial_end", { sessionId: made.dataId, name: "both" })).text).toContain("only an operator session ends a trial");
  });
});
