import { describe, expect, test } from "vitest";
import { MAX_TITLE } from "../../src/context/entries.ts";
import { RULEBOOK, RULE_SECTIONS, SECTION_HEADINGS } from "../../src/context/rulebook-template.ts";

const MAX_RULE_TEXT = 600;
const MAX_QUESTION = 300;
const MOST_SLIM_BRIEF = 13_000;
const KEBAB = /^[a-z]+(-[a-z]+)*$/;

const count = (section: string): number => RULEBOOK.filter((rule) => rule.section === section).length;

describe("tally's rulebook template", () => {
  test("holds 29 rules in four sections: one of authority, nine of safety, thirteen of working and six of once", () => {
    expect(RULEBOOK).toHaveLength(29);
    expect(RULE_SECTIONS.map(count)).toEqual([1, 9, 13, 6]);
  });

  test("lists the sections in their order, and starts and ends with the rules that anchor it", () => {
    const ranks = RULEBOOK.map((rule) => RULE_SECTIONS.indexOf(rule.section));

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(RULEBOOK[0]?.key).toBe("authority-order");
    expect(RULEBOOK.at(-1)?.key).toBe("three-attempts");
  });

  test("gives every rule its own kebab-case key, and no rule a section the pack has no heading for", () => {
    const keys = RULEBOOK.map((rule) => rule.key);

    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => !KEBAB.test(key))).toEqual([]);
    expect(RULEBOOK.filter((rule) => !RULE_SECTIONS.includes(rule.section))).toEqual([]);
    expect(RULE_SECTIONS.filter((section) => SECTION_HEADINGS[section].heading === "" || SECTION_HEADINGS[section].line === "")).toEqual([]);
  });

  test("keeps each title within 120 characters, each text within 600 and each question within 300, and none empty", () => {
    const tooLong = RULEBOOK.filter((rule) => rule.title.length > MAX_TITLE || rule.text.length > MAX_RULE_TEXT || (rule.tailor?.length ?? 0) > MAX_QUESTION);
    const empty = RULEBOOK.filter((rule) => rule.title.trim() === "" || rule.text.trim() === "" || rule.tailor?.trim() === "");

    expect(RULEBOOK.length).toBeGreaterThan(0);
    expect(tooLong.map((rule) => rule.key)).toEqual([]);
    expect(empty.map((rule) => rule.key)).toEqual([]);
  });

  test("asks the project nine questions, each on the rule that only the project can finish", () => {
    expect(RULEBOOK.filter((rule) => rule.tailor !== undefined).map((rule) => rule.key)).toEqual([
      "authority-order",
      "ship-only-when-asked",
      "never-do",
      "not-ours",
      "invariants",
      "no-invented-values",
      "stored-formats",
      "tests-first",
      "check-once",
    ]);
  });

  test("fits, in the slim form a brief carries, within 13,000 characters", () => {
    const slim = RULEBOOK.map(({ section, title, text }, index) => ({ id: `rule-${index + 1}`, section, title, text }));

    expect(slim).toHaveLength(29);
    expect(JSON.stringify(slim).length).toBeLessThan(MOST_SLIM_BRIEF);
  });

  test("ends no title with a full stop, so a heading in a pack reads clean", () => {
    expect(RULEBOOK.filter((rule) => rule.title.endsWith("."))).toEqual([]);
    expect(RULEBOOK.length).toBeGreaterThan(0);
  });
});
