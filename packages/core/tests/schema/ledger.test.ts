import { describe, expect, test } from "vitest";
import { ledgerSchema, taskSchema } from "../../src/schema/ledger.ts";

const task = { id: "T1 fills", track: "engine", status: "planned", also: [] };

describe("the ledger schema", () => {
  test("accepts a planned task without a commit and a landed one with it", () => {
    expect(taskSchema.parse(task).status).toBe("planned");
    expect(taskSchema.parse({ ...task, status: "landed", commit: "abc1234" }).commit).toBe("abc1234");
  });

  test("refuses a landed task without a commit and a planned one with a commit", () => {
    expect(() => taskSchema.parse({ ...task, status: "landed" })).toThrow(/commit/);
    expect(() => taskSchema.parse({ ...task, commit: "abc1234" })).toThrow(/commit/);
  });

  test("refuses a schema it does not know, naming it", () => {
    const ledger = { schema: 2, baseline: "d0ff4a5", milestones: [], other: [] };
    expect(() => ledgerSchema.parse(ledger)).toThrow(/schema/);
  });

  test("fills the empty collections of a bare ledger", () => {
    const ledger = ledgerSchema.parse({ schema: 1, baseline: "d0ff4a5" });
    expect(ledger.milestones).toEqual([]);
    expect(ledger.other).toEqual([]);
  });
});
