import { describe, expect, test } from "vitest";
import { edit, landingFixture } from "../../core/tests/support/landing.ts";
import { runCommand } from "../../core/tests/support/queue.ts";
import { rowOf, serving, sessionOn, taskOf } from "./support/calling.ts";

async function planned() {
  const fixture = await landingFixture("true");
  const call = await serving(fixture.repo);
  const operator = await sessionOn(call, fixture.root, "op");
  const data = await sessionOn(call, fixture.tree);
  await call("milestone_add", { sessionId: operator, id: "A1", stage: "A", name: "reader", track: "data", weight: 1 });
  await call("task_plan", { sessionId: data, milestone: "A1", tasks: ["t1", "t2"] });
  await edit(fixture.tree, "src/a.rs");
  return { ...fixture, call, data };
}

const LANDING = { files: ["src/a.rs"], message: "feat(data): part of it\n" };

describe("land_start with deferred parts", () => {
  test("carries them on its ticket to the task the landing records", async () => {
    const s = await planned();
    const deferred = [{ what: "the index", to: "A1:t2" }, { what: "the docs" }];

    const started = await s.call("land_start", { sessionId: s.data, ...LANDING, milestone: "A1", task: "t1", deferred });
    expect(await runCommand(started.structured["run"] as string)).toBe(0);
    const landed = await s.call("land_wait", { sessionId: s.data, ticket: started.structured["ticket"], after: "turn", seconds: 5 });

    const outcome = landed.structured["landed"] as { head: string; recording: string };
    expect(landed.structured["state"]).toBe("landed");
    expect(outcome.recording).toBe(`A1 't1': landed at ${outcome.head}, in part: 2 deferred`);
    expect(await taskOf(s.call, "A1", "t1")).toMatchObject({ status: "landed", commit: outcome.head, deferred });
    expect((await rowOf(s.call, "A1")).notes).toEqual(["data next: t2", "t1 landed in part: the index, the docs"]);
  });

  test("is refused before it joins the queue without the task to record them on, or with a part left to no MILESTONE:TASK", async () => {
    const s = await planned();

    const adrift = await s.call("land_start", { sessionId: s.data, ...LANDING, deferred: [{ what: "the index" }] });
    const malformed = await s.call("land_start", { sessionId: s.data, ...LANDING, milestone: "A1", task: "t1", deferred: [{ what: "the index", to: "t2" }] });
    const plain = await s.call("land_start", { sessionId: s.data, ...LANDING, milestone: "A1", task: "t1" });

    expect(adrift.isError).toBe(true);
    expect(adrift.text).toBe("deferred parts are recorded on a task: give the landing its milestone and task");
    expect(malformed.text).toBe("a deferred part's to takes MILESTONE:TASK, not 't2'");
    expect(plain.structured["state"]).toBe("turn");
  });
});
