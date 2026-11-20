import { describe, expect, test } from "vitest";
import { adoptRulebook, readRulebook } from "../../src/context/rulebook.ts";
import { RULEBOOK } from "../../src/context/rulebook-template.ts";
import { readKind } from "../../src/context/entries.ts";
import { OPERATOR, keepingContextAsRecords } from "../support/context.ts";
import { makeTracked } from "../support/tracked.ts";

const NEW_IN_080 = ["record-over-brief", "cite-not-restate"];
const TEMPLATE_070 = RULEBOOK.filter((rule) => !NEW_IN_080.includes(rule.key));

describe("a rulebook adopted from the 0.7.0 template", () => {
  test("names the two new rules as not adopted, gains exactly them with its own next ids, and keeps every earlier id", async () => {
    const repo = keepingContextAsRecords((await makeTracked()).repo);
    await adoptRulebook(repo, OPERATOR, new Date("2026-11-20T09:00:00.000Z"), TEMPLATE_070);
    const before = (await readKind(repo, "rule")).entries.map((rule) => [rule.id, rule.template]);

    const waiting = (await readRulebook(repo, {})).template.notAdopted;
    const { added } = await adoptRulebook(repo, OPERATOR, new Date("2026-11-21T09:00:00.000Z"));
    const after = (await readKind(repo, "rule")).entries.map((rule) => [rule.id, rule.template]);

    expect(TEMPLATE_070).toHaveLength(29);
    expect(waiting).toEqual(NEW_IN_080);
    expect(added.map((rule) => rule.id)).toEqual(["rule-30", "rule-31"]);
    expect(after.slice(0, 29)).toEqual(before);
    expect(after.slice(29)).toEqual([["rule-30", "record-over-brief"], ["rule-31", "cite-not-restate"]]);
  });
});
