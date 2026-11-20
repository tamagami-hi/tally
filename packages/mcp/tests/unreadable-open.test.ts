import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { decisionsPath } from "../../core/src/records/decisions.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { connect, keepingContextAsRecords } from "./support/connect.ts";

async function serving() {
  const made = await cycling();
  const repo = keepingContextAsRecords(made.repo);
  const { call } = await connect(repo);
  return { ...made, repo, call };
}

describe("a file that does not parse", () => {
  test("leaves ledger_check answering, with the file named among its problems", async () => {
    const { repo, call } = await serving();
    await writeFile(decisionsPath(repo), "{ not json");

    const checked = await call("ledger_check", {});

    expect(checked.isError, checked.text).toBe(false);
    expect(checked.structured["problems"]).toEqual([expect.stringContaining("decisions.json")]);
  });

  test("never leaves a session open that session_open did not answer: a brief that fails is answered as the session's briefProblem", async () => {
    const { repo, root, call } = await serving();
    await writeFile(join(repo.recordsDir, "ledger.json"), "{ not json");

    const opened = await call("session_open", { worktree: root, agent: "operator-two", brief: "work" });
    const sessions = (await call("session_list", {})).structured["sessions"] as { id: string }[];

    expect(opened.isError, opened.text).toBe(false);
    expect(opened.structured["briefProblem"]).toEqual(expect.stringContaining("ledger.json"));
    expect(sessions.map((one) => one.id)).toContain(opened.structured["id"]);
  });

  test("answers briefProblem as well for a brief that fails with an error that is not tally's own, and the session stays known", async () => {
    const { repo, root, call } = await serving();
    const { mkdir, rm } = await import("node:fs/promises");
    await rm(join(repo.recordsDir, "context", "project.json"), { force: true });
    await mkdir(join(repo.recordsDir, "context", "project.json"), { recursive: true });

    const opened = await call("session_open", { worktree: root, agent: "operator-three", brief: "work" });
    const sessions = (await call("session_list", {})).structured["sessions"] as { id: string }[];

    expect(opened.isError, opened.text).toBe(false);
    expect(opened.structured["briefProblem"]).toEqual(expect.stringContaining("the session is open, but its brief could not be made"));
    expect(sessions.map((one) => one.id)).toContain(opened.structured["id"]);
  });
});
