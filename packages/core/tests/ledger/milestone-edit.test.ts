import { describe, expect, test } from "vitest";
import { findGaps } from "../../src/ledger/gaps.ts";
import { editMilestone } from "../../src/ledger/milestone-edit.ts";
import type { Ledger } from "../../src/schema/ledger.ts";
import { deliverableInputSchema, ledgerSchema } from "../../src/schema/ledger.ts";

const BY = { track: "main", agent: "operator" };
const AT = "2026-11-20T10:00:00.000Z";

const LEDGER: Ledger = {
  schema: 1,
  baseline: "abc1234",
  other: [],
  milestones: [{
    id: "B2", stage: "B", name: "store", track: "data", weight: 1, waits: "the schema",
    delivers: [{ id: "csv", what: "the CSV reader" }, { id: "json", what: "the JSON reader" }, { id: "xml", what: "the XML reader" }],
    tasks: [
      { id: "1 csv", track: "data", status: "landed", commit: "def5678", also: [], covers: ["csv"] },
      { id: "2 json", track: "data", status: "planned", also: [], covers: ["json"] },
    ],
  }],
};

const milestoneOf = (ledger: Ledger) => ledger.milestones[0]!;

describe("editing a milestone", () => {
  test("renames it, and clears its wait with null", () => {
    const { ledger, message } = editMilestone(LEDGER, { milestone: "B2", name: "the store", waits: null }, BY, AT);

    expect(milestoneOf(ledger).name).toBe("the store");
    expect(milestoneOf(ledger)).not.toHaveProperty("waits");
    expect(message).toBe("B2: renamed to 'the store'; no longer waits");
  });

  test("sets a new wait in a line", () => {
    const { ledger } = editMilestone(LEDGER, { milestone: "B2", waits: "the store's owner" }, BY, AT);

    expect(milestoneOf(ledger).waits).toBe("the store's owner");
  });

  test("drops a deliverable no landed task covers, which is then no gap, and keeps who and why", () => {
    const before = findGaps(LEDGER).map((gap) => gap.text);

    const { ledger, message } = editMilestone(LEDGER, { milestone: "B2", drop: [{ id: "xml", why: "no client reads XML", decision: "DEC-4" }] }, BY, AT);

    expect(before.some((text) => text.includes("'xml'"))).toBe(true);
    expect(findGaps(ledger).some((text) => text.text.includes("'xml'"))).toBe(false);
    expect(milestoneOf(ledger).delivers?.find((one) => one.id === "xml")?.dropped).toEqual({ why: "no client reads XML", decision: "DEC-4", by: BY, at: AT });
    expect(message).toBe("B2: dropped xml (no client reads XML; under DEC-4)");
    expect(ledgerSchema.parse(ledger)).toEqual(ledger);
  });

  test("refuses to drop a deliverable a landed task covers, or one it does not have, and changes nothing", () => {
    expect(() => editMilestone(LEDGER, { milestone: "B2", drop: [{ id: "csv", why: "done anyway" }] }, BY, AT)).toThrow("B2's deliverable csv is covered by '1 csv', which landed; a landed deliverable cannot be dropped");
    expect(() => editMilestone(LEDGER, { milestone: "B2", drop: [{ id: "yaml", why: "never mind" }] }, BY, AT)).toThrow("B2 has no deliverable yaml; its deliverables: csv, json, xml");
    expect(() => editMilestone(LEDGER, { milestone: "B2", drop: [{ id: "xml", why: " " }] }, BY, AT)).toThrow(/say why xml is dropped/);
    expect(milestoneOf(LEDGER).delivers?.every((one) => one.dropped === undefined)).toBe(true);
  });

  test("refuses an edit that changes nothing, and a milestone that does not exist", () => {
    expect(() => editMilestone(LEDGER, { milestone: "B2" }, BY, AT)).toThrow("give name, waits or drop: nothing would change B2");
    expect(() => editMilestone(LEDGER, { milestone: "Z9", name: "x" }, BY, AT)).toThrow(/Z9/);
    expect(() => editMilestone(LEDGER, { milestone: "B2", name: "  " }, BY, AT)).toThrow("a milestone's name is a few words, not empty");
  });

  test("leaves dropped out of what milestone_add takes", () => {
    expect(deliverableInputSchema.parse({ id: "x", what: "y", dropped: { why: "z", by: BY, at: AT } })).not.toHaveProperty("dropped");
  });
});
