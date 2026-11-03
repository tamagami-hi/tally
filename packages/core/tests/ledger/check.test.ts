import { describe, expect, test } from "vitest";
import { unrecorded } from "../../src/ledger/check.ts";
import type { Ledger } from "../../src/schema/ledger.ts";

const ledger: Ledger = {
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [{ id: "B2", stage: "B", name: "replay store", track: "data", weight: 11, tasks: [
    { id: "1", track: "data", status: "landed", commit: "e66f464", also: ["6b746e6"] },
  ] }],
  other: [{ commit: "bf8e993", note: "rule" }],
};

describe("the check", () => {
  test("lists the commits on main that no record names, in git's order", () => {
    const log = ["179e964 feat(jobs): defer", "e66f464 docs(store): bytes", "6b746e6 feat(store): codecs", "bf8e993 docs(rules)", "a7caeea feat(store): grids"];
    expect(unrecorded(ledger, log)).toEqual(["179e964 feat(jobs): defer", "a7caeea feat(store): grids"]);
  });

  test("is empty when every commit is known", () => {
    expect(unrecorded(ledger, ["e66f464 x", "bf8e993 y"])).toEqual([]);
  });

  test("passes over the ledger's own records commits when told their prefix", () => {
    const log = ["1111111 records: land B2 '1'", "2222222 feat: real work", "3333333 records-like but not: x"];
    expect(unrecorded(ledger, log, "records:")).toEqual(["2222222 feat: real work", "3333333 records-like but not: x"]);
    expect(unrecorded(ledger, log)).toHaveLength(3);
  });
});
