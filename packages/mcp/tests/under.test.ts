import { describe, expect, test } from "vitest";
import { addDecision } from "../../core/src/records/decisions.ts";
import { readNotes } from "../../core/src/records/notes.ts";
import { addQuestion } from "../../core/src/records/questions.ts";
import { Records } from "../../core/src/store/records.ts";
import { opening } from "../../core/tests/support/opening.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

async function serving() {
  const made = await opening();
  const repo = keepingContextAsRecords(made.repo);
  for (const question of ["first", "second"]) await addQuestion(repo, { group: "core", question, meanwhile: "refuse it" });
  const { call } = await connect(repo);
  return { ...made, repo, call, operator: await opened(call, made.root, "operator"), data: await opened(call, made.trees["data"] ?? "", "claude") };
}

const taskOf = async (repo: Awaited<ReturnType<typeof serving>>["repo"], id: string) => (await new Records(repo).readLedger()).milestones.flatMap((milestone) => milestone.tasks).find((task) => task.id === id);

describe("work built under a question's meanwhile", () => {
  test("task_plan keeps under on a task, and refuses an id that is not an open question by name", async () => {
    const { repo, call, data } = await serving();

    const planned = await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "under one", under: ["1"] }] });
    const refused = await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "under none", under: ["Q-7"] }] });

    expect(planned.isError, planned.text).toBe(false);
    expect(await taskOf(repo, "under one")).toMatchObject({ under: ["Q-1"] });
    expect(refused.text).toContain("Q-7 is not an open question; open: Q-1, Q-2");
    expect(await taskOf(repo, "under none")).toBeUndefined();
  });

  test("task_land keeps under, and land_start refuses it without a task to record it on", async () => {
    const { repo, root, call, data, operator } = await serving();
    const head = await sh(root, ["rev-parse", "--short=7", "HEAD"]);

    const landed = await call("task_land", { sessionId: operator, milestone: "B2", task: "landed by hand", track: "data", commit: head, under: ["Q-2"] });
    const refused = await call("land_start", { sessionId: data, under: ["Q-1"] });

    expect(landed.isError, landed.text).toBe(false);
    expect(await taskOf(repo, "landed by hand")).toMatchObject({ under: ["Q-2"] });
    expect(refused.text).toContain("under is recorded on a task: give the landing its milestone and task");
  });

  test("question_list answers the tasks built under each open question as provisional", async () => {
    const { call, data } = await serving();
    await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "under one", under: ["Q-1"] }, { id: "under both", under: ["Q-1", "Q-2"] }] });

    const open = (await call("question_list", {})).structured["open"] as { id: string; provisional?: string[] }[];

    expect(open.map((question) => [question.id, question.provisional])).toEqual([["Q-1", ["B2 'under one'", "B2 'under both'"]], ["Q-2", ["B2 'under both'"]]]);
  });

  test("question_answer posts tally's note naming the work once, and not again on a second answer", async () => {
    const { repo, call, data, operator } = await serving();
    await addDecision(repo, { id: "DEC-1", group: "core", text: "refuse it for good", since: "2026-11-21", status: "in force" }, { operator: true });
    await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "under one", under: ["Q-1"] }] });

    const answered = await call("question_answer", { sessionId: operator, id: "Q-1", decision: "DEC-1" });
    const again = await call("question_answer", { sessionId: operator, id: "Q-1", decision: "DEC-1" });

    expect(answered.isError, answered.text).toBe(false);
    expect(again.isError).toBe(true);
    expect((await readNotes(repo)).notes.filter((note) => note.about?.record === "Q-1").map((note) => note.text)).toEqual(["Q-1 is answered by DEC-1: check the work built under its meanwhile against the answer: B2 'under one'"]);
  });
});
