import { describe, expect, test } from "vitest";
import { remove } from "../../src/ledger/remove.ts";
import type { Ledger } from "../../src/schema/ledger.ts";

const base = (): Ledger => ({
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [
    { id: "B2", stage: "B", name: "store", track: "data+engine", weight: 1, delivers: [{ id: "manifest", what: "the manifest file" }, { id: "index", what: "the index" }], tasks: [
      { id: "1 reader", track: "data", status: "landed", commit: "abc1234", also: [], covers: ["index"], deferred: [{ what: "the checksum", to: "B2:6 checksum" }] },
      { id: "5 transcoder", track: "data", status: "planned", also: [], covers: ["manifest"] },
      { id: "6 checksum", track: "data", status: "planned", also: [] },
      { id: "7 again", track: "data", status: "planned", also: [], covers: ["index"] },
      { id: "T9 store", track: "engine", status: "planned", also: [], waitsOn: [{ task: "B2:5 transcoder", what: "its format" }] },
    ] },
  ],
  other: [],
});

const idsOf = (ledger: Ledger): string[] => ledger.milestones[0]?.tasks.map((task) => task.id) ?? [];

describe("removing a planned task", () => {
  test("takes it out of its milestone, leaves the others, and says why in its message", () => {
    const removed = remove(base(), { milestone: "B2", task: "7 again", why: "planned twice by mistake" });

    expect(idsOf(removed.ledger)).toEqual(["1 reader", "5 transcoder", "6 checksum", "T9 store"]);
    expect(removed.message).toBe("B2 '7 again': removed (planned twice by mistake)");
    expect(removed.waiters).toEqual([]);
  });

  test("does not change the ledger it was given", () => {
    const ledger = base();

    remove(ledger, { milestone: "B2", task: "7 again", why: "a mistake" });

    expect(idsOf(ledger)).toHaveLength(5);
  });

  test("says what it leaves behind: a deliverable nothing covers now, a wait on it, and a deferred part with nobody to finish it", () => {
    const transcoder = remove(base(), { milestone: "B2", task: "5 transcoder", why: "folded into the reader" });
    const checksum = remove(base(), { milestone: "B2", task: "6 checksum", why: "not needed" });

    expect(transcoder.message).toBe("B2 '5 transcoder': removed (folded into the reader); no task covers manifest now; still waiting on it: B2 'T9 store'");
    expect(transcoder.waiters).toEqual([{ label: "B2 'T9 store'", track: "engine" }]);
    expect(checksum.message).toBe("B2 '6 checksum': removed (not needed); a part deferred to it has no task to finish it now: B2 '1 reader'");
  });

  test("does not call a deliverable uncovered when another task still covers it", () => {
    const withTwo = remove(base(), { milestone: "B2", task: "7 again", why: "a mistake" });

    expect(withTwo.message).not.toContain("no task covers");
  });
});

describe("what cannot be removed", () => {
  test("a landed task, which is the record of its commit", () => {
    expect(() => remove(base(), { milestone: "B2", task: "1 reader", why: "a mistake" })).toThrow("'1 reader' in B2 landed at abc1234: a landed task is the record of its commit and stays");
  });

  test("a task that is not there, or a milestone that is not", () => {
    expect(() => remove(base(), { milestone: "B2", task: "nope", why: "x" })).toThrow("'nope' is not planned in B2");
    expect(() => remove(base(), { milestone: "ZZ", task: "nope", why: "x" })).toThrow("no milestone 'ZZ'");
  });

  test("anything, without a reason", () => {
    expect(() => remove(base(), { milestone: "B2", task: "7 again", why: "  " })).toThrow("say why '7 again' is removed: the reason goes in the record's commit");
  });
});
