import { describe, expect, test } from "vitest";
import { addMilestone, deliver, plan } from "../../src/ledger/ops.ts";
import type { Ledger } from "../../src/schema/ledger.ts";

const stages = ["B"];

const base = (): Ledger => ({
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [
    { id: "B2", stage: "B", name: "store", track: "data+engine", weight: 1, delivers: [{ id: "manifest", what: "the manifest file" }], tasks: [
      { id: "1 reader", track: "data", status: "landed", commit: "abc1234", also: [] },
      { id: "T9 store", track: "engine", status: "planned", also: [] },
      { id: "B2 data close", track: "data", status: "planned", also: [] },
    ] },
    { id: "B1", stage: "B", name: "reader", track: "data", weight: 1, built: "6752fe4..dd43951", tasks: [] },
  ],
  other: [],
});

const tasksOf = (ledger: Ledger) => ledger.milestones[0]!.tasks;

describe("what a milestone delivers", () => {
  test("is kept when the milestone is added, and a milestone added without it has no such key", () => {
    const delivers = [{ id: "grid", what: "the price grid", paths: ["src/grid"] }, { id: "docs", what: "its page" }];

    const owing = addMilestone(base(), { id: "B3", stage: "B", name: "grids", track: "data", weight: 2, delivers }, stages);
    const plain = addMilestone(base(), { id: "B3", stage: "B", name: "grids", track: "data", weight: 2 }, stages);
    const none = addMilestone(base(), { id: "B3", stage: "B", name: "grids", track: "data", weight: 2, delivers: [] }, stages);

    expect(owing.ledger.milestones.at(-1)).toStrictEqual({ id: "B3", stage: "B", name: "grids", track: "data", weight: 2, delivers, tasks: [] });
    expect(plain.ledger.milestones.at(-1)).toStrictEqual({ id: "B3", stage: "B", name: "grids", track: "data", weight: 2, tasks: [] });
    expect(none.ledger.milestones.at(-1)).toStrictEqual(plain.ledger.milestones.at(-1));
  });

  test("is refused at the adding when two deliverables share an id", () => {
    const twice = [{ id: "grid", what: "one" }, { id: "grid", what: "two" }];

    expect(() => addMilestone(base(), { id: "B3", stage: "B", name: "grids", track: "data", weight: 2, delivers: twice }, stages)).toThrow("B3 would deliver 'grid' twice; give each deliverable its own id");
  });

  test("grows by the deliverables added later, after the ones it had", () => {
    const more = deliver(base(), { milestone: "B2", delivers: [{ id: "index", what: "the index" }, { id: "docs", what: "its page", paths: ["docs/store.md"] }] });

    expect(more.ledger.milestones[0]!.delivers).toStrictEqual([{ id: "manifest", what: "the manifest file" }, { id: "index", what: "the index" }, { id: "docs", what: "its page", paths: ["docs/store.md"] }]);
    expect(more.message).toBe("B2: delivers 2 more: index, docs");
    expect(base().milestones[0]!.delivers).toHaveLength(1);
  });

  test("refuses an id the milestone already delivers, an id given twice, an empty list, and a milestone that is built or unknown", () => {
    expect(() => deliver(base(), { milestone: "B2", delivers: [{ id: "manifest", what: "again" }] })).toThrow("B2 already delivers 'manifest'; give the new deliverable another id");
    expect(() => deliver(base(), { milestone: "B2", delivers: [{ id: "x", what: "one" }, { id: "x", what: "two" }] })).toThrow("B2 would deliver 'x' twice; give each deliverable its own id");
    expect(() => deliver(base(), { milestone: "B2", delivers: [] })).toThrow("name at least one deliverable for B2");
    expect(() => deliver(base(), { milestone: "B1", delivers: [{ id: "x", what: "one" }] })).toThrow("B1 is already built");
    expect(() => deliver(base(), { milestone: "B9", delivers: [{ id: "x", what: "one" }] })).toThrow("no milestone 'B9'; known: B2, B1");
  });
});

describe("planning a task with its details", () => {
  test("keeps the brief, the paths and the deliverables it covers, beside tasks given as plain names", () => {
    const planned = plan(base(), { milestone: "B2", track: "data", tasks: ["4 plain", { id: "5 manifest", brief: "write the manifest", paths: ["src/manifest"], covers: ["manifest"] }, { id: "6 bare" }] });

    expect(planned.message).toBe("B2: planned 3 new task(s): 4 plain, 5 manifest, 6 bare");
    expect(planned.added).toEqual(["4 plain", "5 manifest", "6 bare"]);
    expect(tasksOf(planned.ledger).slice(2, 5)).toStrictEqual([
      { id: "4 plain", track: "data", status: "planned", also: [] },
      { id: "5 manifest", track: "data", status: "planned", also: [], brief: "write the manifest", paths: ["src/manifest"], covers: ["manifest"] },
      { id: "6 bare", track: "data", status: "planned", also: [] },
    ]);
    expect(tasksOf(planned.ledger).at(-1)?.id).toBe("B2 data close");
  });

  test("refuses to cover what the milestone does not deliver, naming what it does", () => {
    expect(() => plan(base(), { milestone: "B2", track: "data", tasks: [{ id: "5", covers: ["manifest", "index", "docs"] }] })).toThrow("B2 delivers no 'index', 'docs'; it delivers: manifest");
    const owingNothing = { ...base(), milestones: [{ ...base().milestones[0]!, delivers: [] }] };
    expect(() => plan(owingNothing, { milestone: "B2", track: "data", tasks: [{ id: "5", covers: ["x"] }] })).toThrow("B2 delivers no 'x'; it delivers: nothing yet, add deliverables with milestone_deliver");
  });

  test("a task already planned takes the details given for it, and keeps the ones not given", () => {
    const first = plan(base(), { milestone: "B2", track: "data", tasks: [{ id: "5 manifest", brief: "write the manifest", paths: ["src/manifest"] }] }).ledger;

    const again = plan(first, { milestone: "B2", track: "data", tasks: [{ id: "5 manifest", covers: ["manifest"] }, { id: "1 reader", brief: "the reader" }] });

    expect(again.message).toBe("B2: planned 0 new task(s); set the details of 5 manifest, 1 reader");
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual(["5 manifest", "1 reader"]);
    expect(tasksOf(again.ledger).find((t) => t.id === "5 manifest")).toStrictEqual({ id: "5 manifest", track: "data", status: "planned", also: [], brief: "write the manifest", paths: ["src/manifest"], covers: ["manifest"] });
    expect(tasksOf(again.ledger)[0]).toStrictEqual({ id: "1 reader", track: "data", status: "landed", commit: "abc1234", also: [], brief: "the reader" });
  });

  test("an empty list or an empty brief takes that detail away", () => {
    const first = plan(base(), { milestone: "B2", track: "data", tasks: [{ id: "5 manifest", brief: "write it", paths: ["src/manifest"], covers: ["manifest"] }] }).ledger;

    const cleared = plan(first, { milestone: "B2", track: "data", tasks: [{ id: "5 manifest", brief: "", paths: [], covers: [] }] });

    expect(tasksOf(cleared.ledger).find((t) => t.id === "5 manifest")).toStrictEqual({ id: "5 manifest", track: "data", status: "planned", also: [] });
  });

  test("a task already planned and named again without details is skipped, as a plain name is", () => {
    const again = plan(base(), { milestone: "B2", track: "data", tasks: ["T9 store", { id: "T9 store" }] });

    expect(again.message).toBe("B2: planned 0 new task(s)");
    expect(again.updated).toEqual([]);
    expect(again.ledger).toStrictEqual(base());
  });

  test("refuses to set the details of another track's task", () => {
    expect(() => plan(base(), { milestone: "B2", track: "data", tasks: [{ id: "T9 store", brief: "mine now" }] })).toThrow("'T9 store' in B2 is track engine's task, so track data does not set its details");
  });
});
