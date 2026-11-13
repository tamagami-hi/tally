import { describe, expect, test } from "vitest";
import { RULEBOOK, putEntry } from "../../core/src/index.ts";
import { OPERATOR } from "../../core/tests/support/context.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { ANSWER_LIMIT } from "../src/decorators/sized.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

const SOURCE = "the operator, 2026-11-14";

async function serving() {
  const tracked = await makeTracked();
  const repo = keepingContextAsRecords(tracked.repo);
  const { call } = await connect(repo);
  return { call, repo, data: await opened(call, tracked.trees["data"]!, "claude"), operator: await opened(call, tracked.root, "operator") };
}

describe("rulebook_adopt", () => {
  test("brings the template and answers each rule's id, section and title, never its text", async () => {
    const { call, operator } = await serving();

    const answer = await call("rulebook_adopt", { sessionId: operator });

    expect(answer.isError).toBe(false);
    expect((answer.structured["added"] as unknown[]).length).toBe(29);
    expect((answer.structured["added"] as unknown[])[0]).toEqual({ id: "rule-1", section: "authority", title: RULEBOOK[0]?.title });
    expect((answer.structured["waiting"] as unknown[]).length).toBe(9);
    expect(answer.structured["already"]).toBe(0);
    expect(answer.structured).toHaveProperty("commit");
    expect(answer.text).not.toContain(RULEBOOK[5]?.text ?? "missing");
    expect(answer.text.length).toBeLessThan(8_000);
  });

  test("answers nothing added the second time", async () => {
    const { call, operator } = await serving();
    await call("rulebook_adopt", { sessionId: operator });

    const again = await call("rulebook_adopt", { sessionId: operator });

    expect(again.structured).toMatchObject({ added: [], already: 29, commit: null });
  });

  test("is refused to a track session, with what to do instead", async () => {
    const { call, data } = await serving();

    const refused = await call("rulebook_adopt", { sessionId: data });

    expect(refused).toMatchObject({ isError: true, text: "only an operator session brings the rulebook; a track that wants a rule asks a question with question_add" });
  });

  test("is refused where the rules are a Markdown file", async () => {
    const tracked = await makeTracked();
    const { call } = await connect(tracked.repo);
    const operator = await opened(call, tracked.root, "operator");

    const refused = await call("rulebook_adopt", { sessionId: operator });

    expect(refused).toMatchObject({ isError: true, text: 'this repository\'s rules are its RULES.md (its config does not say context: "records"), so nothing was adopted' });
  });

  test("refuses an argument it does not have, by name", async () => {
    const { call, operator } = await serving();

    const mistyped = await call("rulebook_adopt", { sessionId: operator, section: "safety" });

    expect(mistyped.isError).toBe(true);
    expect(mistyped.text).toContain("section");
  });
});

describe("rulebook_get", () => {
  test("answers the rules whole, in rulebook order, with the count that wait and the template's keys, to a call with no session", async () => {
    const { call, operator } = await serving();
    await call("rulebook_adopt", { sessionId: operator });

    const answer = await call("rulebook_get");
    const rules = answer.structured["rules"] as { id: string; section: string; by: unknown }[];

    expect(answer.isError).toBe(false);
    expect(rules).toHaveLength(29);
    expect(rules[0]).toMatchObject({ id: "rule-1", section: "authority", template: "authority-order", by: { agent: "operator" } });
    expect(answer.structured["waiting"]).toBe(9);
    expect(answer.structured["template"]).toEqual({ adopted: RULEBOOK.map((rule) => rule.key), notAdopted: [] });
  });

  test("lists all 29 keys as not adopted before the template is brought", async () => {
    const { call } = await serving();

    const answer = await call("rulebook_get");

    expect(answer.structured).toMatchObject({ rules: [], waiting: 0, template: { adopted: [], notAdopted: RULEBOOK.map((rule) => rule.key) } });
  });

  test("narrows by section, by waiting, and by the fields asked for", async () => {
    const { call, operator } = await serving();
    await call("rulebook_adopt", { sessionId: operator });

    const safety = await call("rulebook_get", { section: "safety", sessionId: operator });
    const waiting = await call("rulebook_get", { waiting: true });
    const slim = await call("rulebook_get", { fields: ["id", "title"], section: "authority" });

    expect((safety.structured["rules"] as unknown[]).length).toBe(9);
    expect((waiting.structured["rules"] as unknown[]).length).toBe(9);
    expect(slim.structured["rules"]).toEqual([{ id: "rule-1", title: RULEBOOK[0]?.title }]);
  });

  test("refuses a field an entry does not have, and a section that is not one of the four", async () => {
    const { call } = await serving();

    expect((await call("rulebook_get", { fields: ["colour"] })).text).toContain("an entry has no field 'colour'");
    expect((await call("rulebook_get", { section: "tactics" })).isError).toBe(true);
    expect((await call("rulebook_get", { sections: "safety" })).text).toContain("sections");
  });

  test("cuts an answer over the limit from its end, so the first rules stay, and names section and waiting to narrow it", async () => {
    const { call, repo } = await serving();
    for (let index = 0; index < 60; index += 1) await putEntry(repo, OPERATOR, { kind: "rule", title: `rule number ${index}`, text: "w".repeat(1_900), section: "working", source: SOURCE });

    const answer = await call("rulebook_get");
    const kept = answer.structured["rules"] as { id: string }[];

    expect(kept.length).toBeLessThan(60);
    expect(kept[0]?.id).toBe("rule-1");
    expect(answer.text.length).toBeLessThanOrEqual(ANSWER_LIMIT);
    expect(answer.text).toContain("Narrow it with section, waiting or fields.");
  });
});

describe("rule_tailor", () => {
  test("with only a source keeps the rule as written, and answers the rule, the one it retired and how many still wait", async () => {
    const { call, operator } = await serving();
    await call("rulebook_adopt", { sessionId: operator });

    const answer = await call("rule_tailor", { sessionId: operator, id: "rule-2", source: SOURCE });

    expect(answer.isError).toBe(false);
    expect(answer.structured["entry"]).toMatchObject({ id: "rule-30", title: RULEBOOK[1]?.title, template: "ship-only-when-asked", source: SOURCE });
    expect(answer.structured["retired"]).toMatchObject({ id: "rule-2", retiredWhy: "replaced by rule-30" });
    expect(answer.structured["waiting"]).toBe(8);
  });

  test("refuses with what to do next", async () => {
    const { call, operator, data } = await serving();
    await call("rulebook_adopt", { sessionId: operator });
    await call("rule_tailor", { sessionId: operator, id: "rule-2", source: SOURCE });

    expect((await call("rule_tailor", { sessionId: operator, id: "rule-99", source: SOURCE })).text).toBe("no rule rule-99; rulebook_get lists the rules");
    expect((await call("rule_tailor", { sessionId: operator, id: "rule-2", source: SOURCE })).text).toMatch(/^rule-2 was replaced by rule-30 on \d{4}-\d{2}-\d{2}; tailor rule-30$/);
    expect((await call("rule_tailor", { sessionId: data, id: "rule-3", source: SOURCE })).text).toBe("only an operator session tailors a rule; a track that wants one changed asks a question with question_add");
    expect((await call("rule_tailor", { sessionId: operator, id: "rule-3", source: "a\nb" })).text).toContain("one line");
    expect((await call("rule_tailor", { sessionId: operator, id: "rule-3", source: SOURCE, colour: "red" })).text).toContain("colour");
  });
});

describe("context_put for a rule", () => {
  test("needs its section and its source, and the refusal names what to give", async () => {
    const { call, operator } = await serving();

    const noSection = await call("context_put", { sessionId: operator, kind: "rule", title: "t", text: "x", source: SOURCE });
    const noSource = await call("context_put", { sessionId: operator, kind: "rule", title: "t", text: "x", section: "safety" });
    const finding = await call("context_put", { sessionId: operator, kind: "finding", title: "t", text: "x", section: "safety" });
    const written = await call("context_put", { sessionId: operator, kind: "rule", title: "t", text: "x", section: "safety", source: SOURCE });

    expect(noSection.text).toContain("a rule needs its section: authority");
    expect(noSource.text).toContain("a rule needs its source: whose word it is and when");
    expect(finding.text).toBe("only a rule has a section and a source");
    expect(written.structured["entry"]).toMatchObject({ section: "safety", source: SOURCE });
  });
});
