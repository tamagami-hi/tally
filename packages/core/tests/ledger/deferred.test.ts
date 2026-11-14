import { describe, expect, test } from "vitest";
import { countParts, deferredRows, matchingRows, setDeferred } from "../../src/ledger/deferred.ts";
import { findGaps, unfinished } from "../../src/ledger/gaps.ts";
import { assertDeferred } from "../../src/ledger/waits.ts";
import { summarize } from "../../src/status/summary.ts";
import { ledgerSchema } from "../../src/schema/ledger.ts";
import { Records } from "../../src/store/records.ts";
import { ledgerSchema as previousLedgerSchema } from "../fixtures/ledger-0.1.ts";
import { parking, withParts } from "../support/deferred.ts";

const PARKED = { why: "polish later", decision: "DEC-14", owner: "the design lead" };

describe("a parked part", () => {
  test("is no gap, does not make its task landed in part, and the milestone says how many are parked", async () => {
    const { repo } = await parking();
    await withParts(repo, "B2", "done", [{ what: "the docs", parked: PARKED }, { what: "the cache", to: "B2:4 manifest" }]);
    const ledger = await new Records(repo).readLedger();
    const task = ledger.milestones[0]!.tasks.find((one) => one.id === "done")!;

    const summary = await summarize(ledger, repo.config.stages, async () => true);

    expect(findGaps(ledger).map((gap) => gap.text).filter((text) => text.includes("the docs"))).toEqual([]);
    expect(unfinished(ledger, task).map((part) => part.what)).toEqual(["the cache"]);
    expect(summary.rows[0]?.notes).toContain("done: 1 parked");
    expect(summary.rows[0]?.notes).toContain("done landed in part: the cache");
  });

  test("is left to a task or parked, never both", () => {
    expect(() => assertDeferred([{ what: "the docs", to: "B2:4 manifest", parked: { why: "later" } }])).toThrow("a part is left to a task or parked, not both: 'the docs'");
  });

  test("keeps its why and its owner short", () => {
    expect(() => assertDeferred([{ what: "the docs", parked: { why: "x".repeat(201) } }])).toThrow("a parked part's why holds at most 200 characters; this one has 201");
    expect(() => assertDeferred([{ what: "the docs", parked: { why: "later", owner: "y".repeat(61) } }])).toThrow("a parked part's owner holds at most 60 characters; this one has 61");
  });

  test("is read by the previous release as a part with no task, and nothing else is lost", async () => {
    const { repo } = await parking();
    await withParts(repo, "B2", "done", [{ what: "the docs", parked: PARKED }]);
    const written = ledgerSchema.parse(await new Records(repo).readLedger());

    const previous = previousLedgerSchema.parse(JSON.parse(JSON.stringify(written)));

    expect(previous.milestones[0]?.tasks.find((one) => one.id === "done")?.deferred).toEqual([{ what: "the docs" }]);
  });
});

describe("placing a deferred part", () => {
  test("moves a part from a task to parked and back, answering it as it was and as it is", async () => {
    const { repo, operator } = await parking();

    const parked = await setDeferred(repo, operator, { milestone: "B2", task: "done", part: 1, parked: PARKED });
    const back = await setDeferred(repo, operator, { milestone: "B2", task: "done", part: 1, to: "B2:5 transcoder" });

    expect(parked.before).toEqual({ what: "the docs", to: "B2:4 manifest" });
    expect(parked.after).toEqual({ what: "the docs", parked: PARKED });
    expect(back.after).toEqual({ what: "the docs", to: "B2:5 transcoder" });
    expect(parked.message).toBe("B2 'done': part 1 (the docs) parked, under DEC-14");
  });

  test("leaves the same record when the same call is made twice", async () => {
    const { repo, operator } = await parking();
    await setDeferred(repo, operator, { milestone: "B2", task: "done", part: 2, parked: PARKED });
    const once = await new Records(repo).readLedger();

    await setDeferred(repo, operator, { milestone: "B2", task: "done", part: 2, parked: PARKED });

    expect(await new Records(repo).readLedger()).toEqual(once);
  });

  test("is refused to a track session that names no decision, and says who may", async () => {
    const { repo, data } = await parking();

    await expect(setDeferred(repo, data, { milestone: "B2", task: "done", part: 2, parked: { why: "later" } })).rejects.toThrow("an operator session parks a part; or name the decision that covers it");
  });

  test("lets a session that may write the task park it under a decision", async () => {
    const { repo, data } = await parking();

    const placed = await setDeferred(repo, data, { milestone: "B2", task: "done", part: 2, parked: { why: "later", decision: "DEC-14" } });

    expect(placed.after).toEqual({ what: "the cache", parked: { why: "later", decision: "DEC-14" } });
  });

  test("refuses a session of another track", async () => {
    const { repo, engine } = await parking();

    await expect(setDeferred(repo, engine, { milestone: "B2", task: "done", part: 2, to: "B2:T9 store" })).rejects.toThrow(/may not write track data/);
  });

  test("refuses a decision that is not in the record, and points at decision_list", async () => {
    const { repo, operator } = await parking();

    await expect(setDeferred(repo, operator, { milestone: "B2", task: "done", part: 2, parked: { why: "later", decision: "DEC-99" } })).rejects.toThrow("no decision DEC-99; decision_list shows the decisions");
  });

  test("names how many parts the task has when the part is out of range", async () => {
    const { repo, operator } = await parking();

    await expect(setDeferred(repo, operator, { milestone: "B2", task: "done", part: 3, to: "B2:4 manifest" })).rejects.toThrow("B2 'done' has 2 deferred parts; part is a number from 1 to 2, as deferred_list shows it");
    await expect(setDeferred(repo, operator, { milestone: "B2", task: "4 manifest", part: 1, to: "B2:5 transcoder" })).rejects.toThrow("B2 '4 manifest' has no deferred parts");
  });

  test("takes exactly one of to and parked", async () => {
    const { repo, operator } = await parking();

    await expect(setDeferred(repo, operator, { milestone: "B2", task: "done", part: 1 })).rejects.toThrow("give the part a task to finish it (to) or park it (parked)");
    await expect(setDeferred(repo, operator, { milestone: "B2", task: "done", part: 1, to: "B2:4 manifest", parked: PARKED })).rejects.toThrow("a part is left to a task or parked, not both: 'the docs'");
  });
});

describe("listing deferred parts", () => {
  test("gives each part its place, its state and where it went, and counts the whole ledger whatever the filter", async () => {
    const { repo } = await parking();
    await withParts(repo, "B2", "done", [{ what: "the docs", to: "B2:4 manifest" }, { what: "the cache" }, { what: "the icons", parked: PARKED }, { what: "the old api", to: "B2:done" }]);
    const rows = deferredRows(await new Records(repo).readLedger());

    const parked = matchingRows(rows, { decision: "DEC-14" });

    expect(rows.map((row) => [row.part, row.state])).toEqual([[1, "waiting"], [2, "unplaced"], [3, "parked"], [4, "done"]]);
    expect(parked).toEqual([{ milestone: "B2", task: "done", track: "data", part: 3, what: "the icons", state: "parked", parked: PARKED }]);
    expect(countParts(rows)).toEqual({ unplaced: 1, waiting: 1, done: 1, parked: 1 });
    expect(matchingRows(rows, { owner: "the design lead", state: "waiting" })).toEqual([]);
  });
});
