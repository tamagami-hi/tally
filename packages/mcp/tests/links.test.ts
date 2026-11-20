import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { addDecision } from "../../core/src/records/decisions.ts";
import { Records } from "../../core/src/store/records.ts";
import { readTracks } from "../../core/src/tracks/file.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

async function serving() {
  const made = await cycling();
  const repo = keepingContextAsRecords(made.repo);
  const { call } = await connect(repo);
  await addDecision(repo, { id: "DEC-1", group: "core", text: "JSON only.", since: "2026-11-20", status: "decided, not built" }, { operator: true });
  return { ...made, repo, call, operator: await opened(call, made.root, "operator-two"), eng: await opened(call, join(made.root, ".temp/worktrees/eng"), "kiro") };
}

const tasksOf = async (repo: Awaited<ReturnType<typeof serving>>["repo"], milestone: string) => (await new Records(repo).readLedger()).milestones.find((one) => one.id === milestone)?.tasks ?? [];

describe("a task's cites and accept", () => {
  test("task_plan keeps them, and refuses an id no record has by name, writing nothing", async () => {
    const { repo, call, eng } = await serving();

    const refused = await call("task_plan", { sessionId: eng, milestone: "A2", tasks: [{ id: "3 cite", cites: ["DEC-1", "note-77"] }] });
    const planned = await call("task_plan", { sessionId: eng, milestone: "A2", tasks: [{ id: "3 cite", cites: ["DEC-1", "review-1"], accept: ["the writer refuses CSV"] }] });

    expect(refused.text).toContain("no record has the id note-77");
    expect(planned.isError, planned.text).toBe(false);
    expect((await tasksOf(repo, "A2")).find((task) => task.id === "3 cite")).toMatchObject({ cites: ["DEC-1", "review-1"], accept: ["the writer refuses CSV"] });
  });

  test("track_open's plan refuses an unknown id before the track is opened", async () => {
    const { repo, call, operator } = await serving();

    const refused = await call("track_open", { sessionId: operator, name: "lane", purpose: "a lane", plan: { milestone: "A2", tasks: [{ id: "4 lane", cites: ["DEC-9"] }] } });

    expect(refused.text).toContain("no record has the id DEC-9");
    expect((await readTracks(repo.recordsDir)).tracks.map((track) => track.name)).not.toContain("lane");
  });

  test("a citation of a record a closed cycle archived is accepted after the close", async () => {
    const { repo, call, operator, eng } = await serving();
    await call("cycle_close", { sessionId: operator, summary: "the reader is built", said: "close it" });

    const planned = await call("task_plan", { sessionId: eng, milestone: "A2", tasks: [{ id: "5 after", cites: ["review-1"] }] });

    expect(planned.isError, planned.text).toBe(false);
    expect((await tasksOf(repo, "A2")).map((task) => task.id)).toContain("5 after");
  });
});

describe("a decision's links and the hint to mark it", () => {
  test("decision_record keeps accept and paths, and decision_list answers them", async () => {
    const { call, operator } = await serving();

    await call("decision_record", { sessionId: operator, group: "core", text: "The writer writes JSON.", said: "JSON out", accept: ["the writer writes JSON"], paths: ["src/writer/**"] });
    const listed = (await call("decision_list", { ids: ["DEC-2"] })).structured["decisions"] as Record<string, unknown>[];

    expect(listed[0]).toMatchObject({ id: "DEC-2", accept: ["the writer writes JSON"], paths: ["src/writer/**"] });
  });

  test("ledger_check and an operator session's brief name a decision whose citing tasks have all landed", async () => {
    const { repo, call, root } = await serving();
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((one) => (one.id === "A1" ? { ...one, tasks: one.tasks.map((task) => ({ ...task, cites: ["DEC-1"] })) } : one)) }, message: "cited" }));

    const checked = await call("ledger_check", {});
    const brief = (await call("session_open", { worktree: root, agent: "operator-three" })).structured["brief"] as Record<string, unknown>;

    expect(checked.structured["decisionsToMark"]).toEqual([{ id: "DEC-1", group: "core", state: "decided, not built", tasks: ["A1:1 read"] }]);
    expect(brief["decisionsToMark"]).toEqual(checked.structured["decisionsToMark"]);
  });
});
