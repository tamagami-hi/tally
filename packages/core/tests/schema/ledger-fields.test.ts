import { describe, expect, test } from "vitest";
import { ledgerSchema, milestoneSchema, taskSchema } from "../../src/schema/ledger.ts";

const old = {
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [{ id: "B2", stage: "B", name: "store", track: "data", weight: 1, tasks: [
    { id: "1", track: "data", status: "landed", commit: "abc1234", also: ["def5678"] },
    { id: "2", track: "data", status: "planned", also: [], waits: "B1" },
  ] }],
  other: [{ commit: "bf8e993", note: "rule" }],
};

const task = { id: "T1 fills", track: "engine", status: "planned", also: [] };

describe("the ledger's optional fields", () => {
  test("an old ledger parses to exactly what it was, with none of the new keys", () => {
    expect(ledgerSchema.parse(old)).toStrictEqual(old);
  });

  test("a milestone keeps what it delivers, with or without paths", () => {
    const delivers = [{ id: "manifest", what: "the manifest file", paths: ["src/manifest"] }, { id: "index", what: "the index" }];

    const milestone = milestoneSchema.parse({ ...old.milestones[0], delivers });

    expect(milestone.delivers).toStrictEqual(delivers);
  });

  test("a task keeps its brief, its paths, what it covers and what it waits on", () => {
    const more = { brief: "write the manifest", paths: ["src/manifest"], covers: ["manifest"], waitsOn: [{ task: "B2:5 transcoder", what: "its output format" }, { note: "n-12", what: "an answer" }, { what: "the recorder" }] };

    expect(taskSchema.parse({ ...task, ...more })).toStrictEqual({ ...task, ...more });
  });

  test("a landed task keeps its deferred parts, with or without the task that will finish each", () => {
    const deferred = [{ what: "the index", to: "B2:9 index" }, { what: "the docs" }];

    expect(taskSchema.parse({ ...task, status: "landed", commit: "abc1234", deferred }).deferred).toStrictEqual(deferred);
  });

  test("refuses a deliverable with no id, and a deferred part or a wait that says nothing of what", () => {
    expect(() => milestoneSchema.parse({ ...old.milestones[0], delivers: [{ id: "", what: "x" }] })).toThrow();
    expect(() => taskSchema.parse({ ...task, status: "landed", commit: "abc1234", deferred: [{ to: "B2:9 index" }] })).toThrow();
    expect(() => taskSchema.parse({ ...task, waitsOn: [{ task: "B2:5 transcoder" }] })).toThrow();
  });
});
