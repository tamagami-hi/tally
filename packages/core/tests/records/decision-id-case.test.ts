import { describe, expect, test } from "vitest";
import { recordDecision } from "../../src/records/decision-record.ts";
import { readDecisions } from "../../src/records/decisions.ts";
import { AT, cycling } from "../support/cycling.ts";

describe("decision_record and an id's letter case", () => {
  test("refuses an id that differs from one of its group's only by letter case, and writes nothing", async () => {
    const { repo, operator } = await cycling();
    await recordDecision(repo, operator, { group: "core", id: "OPS-1", text: "one", said: "one" }, AT);

    await expect(recordDecision(repo, operator, { group: "core", id: "ops-1", text: "two", said: "two" }, AT)).rejects.toThrow("core already has decision OPS-1, which ops-1 differs from only by letter case; give OPS-1 with replaces to replace it, or another id");
    expect((await readDecisions(repo)).decisions.map((one) => one.id)).toEqual(["OPS-1"]);
  });

  test("takes the same id in another group", async () => {
    const { repo, operator } = await cycling();
    await recordDecision(repo, operator, { group: "core", id: "OPS-1", text: "one", said: "one" }, AT);

    await recordDecision(repo, operator, { group: "web", id: "ops-1", text: "two", said: "two" }, AT);

    expect((await readDecisions(repo)).decisions.map((one) => [one.group, one.id])).toEqual([["core", "OPS-1"], ["web", "ops-1"]]);
  });
});
