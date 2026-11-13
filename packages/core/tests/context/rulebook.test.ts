import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { putEntry, readKind, retireEntry } from "../../src/context/entries.ts";
import { adoptRulebook, inRulebookOrder, readRulebook, tailorRule, waitingRules } from "../../src/context/rulebook.ts";
import { RULEBOOK, RULEBOOK_SOURCE, type TemplateRule } from "../../src/context/rulebook-template.ts";
import { DATA, OPERATOR, keepingContextAsRecords } from "../support/context.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const NINE = new Date("2026-11-14T09:00:00Z");
const TEN = new Date("2026-11-15T10:00:00Z");
const SOURCE = "the operator, 2026-11-14";
const WAITING = RULEBOOK.filter((rule) => rule.tailor !== undefined);

const ruleFile = (root: string): Promise<string> => readFile(join(root, "docs/records/context/rule.json"), "utf8");

async function adopting(records: { commit?: boolean } = {}) {
  const tracked = await makeTracked(records);
  const repo = keepingContextAsRecords(tracked.repo);
  return { ...tracked, repo };
}

const small = (count: number, wording = "words"): TemplateRule[] => Array.from({ length: count }, (_, index) => ({ key: `rule-${index}`, section: "working" as const, title: `title ${index}`, text: `${wording} ${index}` }));

describe("adoptRulebook", () => {
  test("adds every rule of the template in its order, each with its section, its key and the template as its source", async () => {
    const { repo } = await adopting();

    const { added } = await adoptRulebook(repo, OPERATOR, NINE);
    const { entries } = await readKind(repo, "rule");

    expect(added).toHaveLength(29);
    expect(entries.map((entry) => entry.id)).toEqual(RULEBOOK.map((_, index) => `rule-${index + 1}`));
    expect(entries.map((entry) => entry.template)).toEqual(RULEBOOK.map((rule) => rule.key));
    expect(entries[1]).toEqual({ id: "rule-2", kind: "rule", title: RULEBOOK[1]?.title, text: RULEBOOK[1]?.text, paths: [], tags: [], refs: [], by: OPERATOR, at: NINE.toISOString(), section: "safety", source: RULEBOOK_SOURCE, template: "ship-only-when-asked", tailor: RULEBOOK[1]?.tailor });
    expect(entries[2]).not.toHaveProperty("tailor");
  });

  test("answers each rule's id, section and title, the rules that wait with their question, and no rule's text", async () => {
    const { repo } = await adopting();

    const answer = await adoptRulebook(repo, OPERATOR, NINE);

    expect(answer.added[0]).toEqual({ id: "rule-1", section: "authority", title: RULEBOOK[0]?.title });
    expect(answer.waiting).toHaveLength(9);
    expect(answer.waiting[0]).toEqual({ id: "rule-1", title: RULEBOOK[0]?.title, tailor: RULEBOOK[0]?.tailor });
    expect(answer.already).toBe(0);
    expect(answer.commit).toBeNull();
    expect(JSON.stringify(answer)).not.toContain(RULEBOOK[3]?.text ?? "missing");
  });

  test("a second call adds nothing, writes nothing and makes no commit", async () => {
    const { repo, root } = await adopting({ commit: true });
    await adoptRulebook(repo, OPERATOR, NINE);
    const before = { file: await ruleFile(root), commits: await sh(root, ["rev-list", "--count", "HEAD"]) };

    const again = await adoptRulebook(repo, OPERATOR, TEN);

    expect(again).toMatchObject({ added: [], already: 29, commit: null });
    expect(again.waiting).toHaveLength(9);
    expect(await ruleFile(root)).toBe(before.file);
    expect(await sh(root, ["rev-list", "--count", "HEAD"])).toBe(before.commits);
  });

  test("makes one records commit for all of it where the config commits", async () => {
    const { repo, root } = await adopting({ commit: true });
    const before = Number(await sh(root, ["rev-list", "--count", "HEAD"]));

    const { commit } = await adoptRulebook(repo, OPERATOR, NINE);

    expect(commit).toMatch(/^[0-9a-f]{7}$/);
    expect(Number(await sh(root, ["rev-list", "--count", "HEAD"]))).toBe(before + 1);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: 29 rules of tally's rulebook template added by operator");
  });

  test("never brings back a template rule that was tailored or retired, in force or not", async () => {
    const { repo } = await adopting();
    await adoptRulebook(repo, OPERATOR, NINE);
    await tailorRule(repo, OPERATOR, { id: "rule-1", source: SOURCE, text: "our own order" }, NINE);
    await retireEntry(repo, OPERATOR, "rule-3", "we do not handle credentials", NINE);

    const again = await adoptRulebook(repo, OPERATOR, TEN);

    expect(again).toMatchObject({ added: [], already: 29 });
    expect((await readKind(repo, "rule")).entries).toHaveLength(30);
  });

  test("brings only the rules a later template added, and never a changed wording of one the repository has", async () => {
    const { repo } = await adopting();
    await adoptRulebook(repo, OPERATOR, NINE, small(2));

    const later = await adoptRulebook(repo, OPERATOR, TEN, [...small(2, "new words"), ...small(3).slice(2)]);
    const { entries } = await readKind(repo, "rule");

    expect(later.added).toEqual([{ id: "rule-3", section: "working", title: "title 2" }]);
    expect(later.already).toBe(2);
    expect(entries.map((entry) => entry.text)).toEqual(["words 0", "words 1", "words 2"]);
  });

  test("numbers its rules after the ones the repository already has, which it leaves as they are", async () => {
    const { repo } = await adopting();
    await putEntry(repo, OPERATOR, { kind: "rule", title: "our own", text: "x", section: "safety", source: SOURCE }, NINE);

    const { added } = await adoptRulebook(repo, OPERATOR, TEN, small(2));

    expect(added.map((rule) => rule.id)).toEqual(["rule-2", "rule-3"]);
    expect((await readKind(repo, "rule")).entries[0]).toMatchObject({ id: "rule-1", title: "our own" });
  });

  test("is refused to a track session, and in a repository whose rules are a Markdown file, and writes nothing then", async () => {
    const tracked = await makeTracked();
    const records = keepingContextAsRecords(tracked.repo);

    await expect(adoptRulebook(records, DATA, NINE)).rejects.toThrow("only an operator session brings the rulebook; a track that wants a rule asks a question with question_add");
    await expect(adoptRulebook(tracked.repo, OPERATOR, NINE)).rejects.toThrow('this repository\'s rules are its RULES.md (its config does not say context: "records"), so nothing was adopted');
    expect(await readKind(records, "rule")).toMatchObject({ nextNumber: 1, entries: [] });
  });
});

describe("tailorRule", () => {
  test("with only a source, keeps the rule as written, settles it, and retires the old one", async () => {
    const { repo } = await adopting();
    await adoptRulebook(repo, OPERATOR, NINE);

    const { entry, retired, waiting } = await tailorRule(repo, OPERATOR, { id: "rule-2", source: SOURCE }, TEN);

    expect(entry).toMatchObject({ id: "rule-30", title: RULEBOOK[1]?.title, text: RULEBOOK[1]?.text, section: "safety", source: SOURCE, template: "ship-only-when-asked", replaces: "rule-2", at: TEN.toISOString() });
    expect(entry).not.toHaveProperty("tailor");
    expect(retired).toMatchObject({ id: "rule-2", retiredAt: TEN.toISOString(), retiredWhy: "replaced by rule-30" });
    expect(waiting).toBe(8);
  });

  test("replaces what it is given, and keeps the rest", async () => {
    const { repo } = await adopting();
    await adoptRulebook(repo, OPERATOR, NINE);

    const { entry } = await tailorRule(repo, OPERATOR, { id: "rule-11", source: "DEC-4", title: "Tests live in tests/", text: "Every test sits in tests/ beside its package.", section: "safety", paths: ["packages/core"], tags: ["tests"], refs: ["DEC-4"] }, TEN);

    expect(entry).toMatchObject({ title: "Tests live in tests/", text: "Every test sits in tests/ beside its package.", section: "safety", paths: ["packages/core"], tags: ["tests"], refs: ["DEC-4"], source: "DEC-4", template: "tests-first" });
    const kept = await tailorRule(repo, OPERATOR, { id: "rule-12", source: SOURCE, paths: ["src"] }, TEN);
    expect(kept.entry).toMatchObject({ title: RULEBOOK[11]?.title, paths: ["src"], tags: [], refs: [] });
  });

  test("counts down the rules that still wait, and a rule that asks nothing leaves the count as it is", async () => {
    const { repo } = await adopting();
    await adoptRulebook(repo, OPERATOR, NINE);

    const asking = await tailorRule(repo, OPERATOR, { id: "rule-1", source: SOURCE }, TEN);
    const plain = await tailorRule(repo, OPERATOR, { id: "rule-3", source: SOURCE }, TEN);

    expect([asking.waiting, plain.waiting]).toEqual([8, 8]);
    expect(waitingRules((await readKind(repo, "rule")).entries)).toHaveLength(8);
  });

  test("needs a section for a rule written before sections, and a source always", async () => {
    const { repo } = await adopting();
    await putEntry(repo, OPERATOR, { kind: "rule", title: "ours", text: "x", section: "safety", source: SOURCE }, NINE);
    const legacy = { id: "rule-1", kind: "rule" as const, title: "old", text: "x", paths: [], tags: [], refs: [], by: OPERATOR, at: "2026-11-01T09:00:00.000Z" };
    const file = await readKind(repo, "rule");
    const { writeJsonAtomic } = await import("../../src/store/json.ts");
    await writeJsonAtomic(join(repo.recordsDir, "context", "rule.json"), { ...file, entries: [legacy] });

    await expect(tailorRule(repo, OPERATOR, { id: "rule-1", source: SOURCE }, TEN)).rejects.toThrow(/a rule needs its section/);
    await expect(tailorRule(repo, OPERATOR, { id: "rule-1", source: "", section: "working" }, TEN)).rejects.toThrow(/a rule needs its source/);
    expect((await tailorRule(repo, OPERATOR, { id: "rule-1", source: SOURCE, section: "working" }, TEN)).entry).toMatchObject({ section: "working" });
  });

  test("is refused for an unknown rule, a replaced one, a retired one, an entry that is no rule, and a track session", async () => {
    const { repo } = await adopting();
    await adoptRulebook(repo, OPERATOR, NINE);
    await tailorRule(repo, OPERATOR, { id: "rule-7", source: SOURCE }, TEN);
    await retireEntry(repo, OPERATOR, "rule-8", "not our data", TEN);
    await putEntry(repo, DATA, { kind: "finding", title: "f", text: "g" }, NINE);

    await expect(tailorRule(repo, OPERATOR, { id: "rule-99", source: SOURCE })).rejects.toThrow("no rule rule-99; rulebook_get lists the rules");
    await expect(tailorRule(repo, OPERATOR, { id: "rule-7", source: SOURCE })).rejects.toThrow("rule-7 was replaced by rule-30 on 2026-11-15; tailor rule-30");
    await expect(tailorRule(repo, OPERATOR, { id: "rule-8", source: SOURCE })).rejects.toThrow("rule-8 was retired on 2026-11-15 (not our data); a new rule is added with context_put");
    await expect(tailorRule(repo, OPERATOR, { id: "finding-1", source: SOURCE })).rejects.toThrow("finding-1 is not a rule; rule_tailor changes a rule");
    await expect(tailorRule(repo, DATA, { id: "rule-1", source: SOURCE })).rejects.toThrow("only an operator session tailors a rule; a track that wants one changed asks a question with question_add");
    expect((await readKind(repo, "rule")).nextNumber).toBe(31);
  });

  test("points a replaced rule at the newest successor still in force", async () => {
    const { repo } = await adopting();
    await adoptRulebook(repo, OPERATOR, NINE);
    await tailorRule(repo, OPERATOR, { id: "rule-7", source: SOURCE }, TEN);
    await tailorRule(repo, OPERATOR, { id: "rule-30", source: SOURCE }, TEN);

    await expect(tailorRule(repo, OPERATOR, { id: "rule-7", source: SOURCE })).rejects.toThrow("rule-7 was replaced by rule-31 on 2026-11-15; tailor rule-31");
  });
});

describe("the order of the rules", () => {
  const rule = (id: string, section?: string) => ({ id, ...(section === undefined ? {} : { section }) });

  test("is by section, then by number, with a rule that has no section last", () => {
    const shuffled = [rule("rule-1"), rule("rule-12", "once"), rule("rule-3", "working"), rule("rule-10", "safety"), rule("rule-2", "safety"), rule("rule-4", "authority"), rule("rule-5")];

    expect(inRulebookOrder(shuffled).map((each) => each.id)).toEqual(["rule-4", "rule-2", "rule-10", "rule-3", "rule-12", "rule-1", "rule-5"]);
    expect(shuffled[0]?.id).toBe("rule-1");
  });
});

describe("readRulebook", () => {
  test("answers the rules in force in rulebook order, how many wait, and which template rules were never adopted", async () => {
    const { repo } = await adopting();
    await putEntry(repo, OPERATOR, { kind: "rule", title: "ours", text: "x", section: "authority", source: SOURCE }, NINE);

    const before = await readRulebook(repo, {});
    await adoptRulebook(repo, OPERATOR, NINE);
    await tailorRule(repo, OPERATOR, { id: "rule-2", source: SOURCE }, TEN);
    const after = await readRulebook(repo, {});

    expect(before.rules.map((each) => each.id)).toEqual(["rule-1"]);
    expect(before.template).toEqual({ adopted: [], notAdopted: RULEBOOK.map((each) => each.key) });
    expect(after.rules.map((each) => each.id).slice(0, 3)).toEqual(["rule-1", "rule-31", "rule-3"]);
    expect(after.rules.find((each) => each.id === "rule-31")).toMatchObject({ template: "authority-order" });
    expect(after.rules).toHaveLength(30);
    expect(after.waiting).toBe(8);
    expect(after.template.notAdopted).toEqual([]);
    expect(after.template.adopted).toEqual(RULEBOOK.map((each) => each.key));
  });

  test("keeps one section, or only the rules that still wait", async () => {
    const { repo } = await adopting();
    await adoptRulebook(repo, OPERATOR, NINE);

    const safety = await readRulebook(repo, { section: "safety" });
    const waiting = await readRulebook(repo, { waiting: true });

    expect(safety.rules).toHaveLength(9);
    expect(safety.rules.every((each) => each.section === "safety")).toBe(true);
    expect(safety.waiting).toBe(9);
    expect(waiting.rules.map((each) => each.template)).toEqual(WAITING.map((each) => each.key));
  });

  test("refuses a section that is not one of the four", async () => {
    const { repo } = await adopting();

    await expect(readRulebook(repo, { section: "tactics" })).rejects.toThrow("'tactics' is not a rule section: authority, safety, working or once");
  });
});
