import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MAX_NAMED, putEntry, readKind, type EntryInput } from "../../src/context/entries.ts";
import { DATA, OPERATOR } from "../support/context.ts";
import { makeTracked } from "../support/tracked.ts";

const SOURCE = "the operator, 2026-11-14";
const NEEDS_SECTION = "a rule needs its section: authority (what wins when sources disagree), safety (what fails the work), working (how the work is done) or once (doing each thing once)";
const NEEDS_SOURCE = 'a rule needs its source: whose word it is and when, such as "the operator, 2026-11-14", or the id of the decision it rests on';
const NINE = new Date("2026-11-14T09:00:00Z");

const rule = (extra: Partial<EntryInput> = {}): EntryInput => ({ kind: "rule", title: "never push main", text: "pushing is the operator's", section: "safety", source: SOURCE, ...extra });

const without = (input: EntryInput, ...keys: readonly string[]): EntryInput => Object.fromEntries(Object.entries(input).filter(([name]) => !keys.includes(name))) as unknown as EntryInput;

async function writeLegacyRule(root: string): Promise<void> {
  const entry = { id: "rule-1", kind: "rule", title: "keep it simple", text: "no abstraction without a need", paths: [], tags: [], refs: [], by: OPERATOR, at: "2026-11-01T09:00:00.000Z" };
  await mkdir(join(root, "docs/records/context"), { recursive: true });
  await writeFile(join(root, "docs/records/context/rule.json"), JSON.stringify({ schema: 1, kind: "rule", nextNumber: 2, entries: [entry] }));
}

describe("a rule's section and source", () => {
  test("are kept on the rule that was written, with the words it was given trimmed", async () => {
    const { repo, root } = await makeTracked();

    const { entry } = await putEntry(repo, OPERATOR, rule({ section: "working", source: `  ${SOURCE}  ` }), NINE);

    expect(entry).toMatchObject({ id: "rule-1", section: "working", source: SOURCE });
    expect(JSON.parse(await readFile(join(root, "docs/records/context/rule.json"), "utf8")).entries[0]).toMatchObject({ section: "working", source: SOURCE });
  });

  test("are required of a rule, and the refusal says what to give", async () => {
    const { repo } = await makeTracked();

    await expect(putEntry(repo, OPERATOR, without(rule(), "section"))).rejects.toThrow(NEEDS_SECTION);
    await expect(putEntry(repo, OPERATOR, without(rule(), "source"))).rejects.toThrow(NEEDS_SOURCE);
    await expect(putEntry(repo, OPERATOR, rule({ source: "   " }))).rejects.toThrow(NEEDS_SOURCE);
    await expect(putEntry(repo, OPERATOR, { kind: "rule", title: "a", text: "b" })).rejects.toThrow(NEEDS_SECTION);
    expect(await readKind(repo, "rule")).toMatchObject({ nextNumber: 1, entries: [] });
  });

  test("refuse a section that is not one of the four, a source on two lines, and a source that is too long", async () => {
    const { repo } = await makeTracked();

    await expect(putEntry(repo, OPERATOR, rule({ section: "tactics" }))).rejects.toThrow("'tactics' is not a rule section: authority, safety, working or once");
    await expect(putEntry(repo, OPERATOR, rule({ source: "the operator,\n2026-11-14" }))).rejects.toThrow('a rule\'s source is one line, such as "the operator, 2026-11-14"');
    await expect(putEntry(repo, OPERATOR, rule({ source: "s".repeat(MAX_NAMED + 1) }))).rejects.toThrow("a rule's source holds at most 200 characters; this one has 201");
    expect((await putEntry(repo, OPERATOR, rule({ source: "s".repeat(MAX_NAMED) }))).entry.id).toBe("rule-1");
  });

  test("are refused on any other kind of entry, which is not written then", async () => {
    const { repo } = await makeTracked();
    const finding = { kind: "finding" as const, title: "the lock is a folder", text: "it holds no file" };

    await expect(putEntry(repo, DATA, { ...finding, section: "safety" })).rejects.toThrow("only a rule has a section and a source");
    await expect(putEntry(repo, DATA, { ...finding, source: SOURCE })).rejects.toThrow("only a rule has a section and a source");
    await expect(putEntry(repo, DATA, { ...finding, kind: "convention", section: "working", source: SOURCE })).rejects.toThrow("only a rule has a section and a source");
    expect(await readKind(repo, "finding")).toMatchObject({ nextNumber: 1, entries: [] });
    expect((await putEntry(repo, DATA, finding)).entry).not.toHaveProperty("section");
  });

  test("pass from a rule to its successor, unless the successor says otherwise, and the source is always given anew", async () => {
    const { repo } = await makeTracked();
    await putEntry(repo, OPERATOR, rule({ section: "safety" }), NINE);

    const kept = await putEntry(repo, OPERATOR, without(rule({ title: "never push to main", replaces: "rule-1", source: "DEC-12" }), "section"), NINE);
    const moved = await putEntry(repo, OPERATOR, rule({ replaces: "rule-2", section: "once" }), NINE);
    const bare = { kind: "rule" as const, title: "x", text: "y", replaces: "rule-3" };

    expect(kept.entry).toMatchObject({ id: "rule-2", section: "safety", source: "DEC-12", replaces: "rule-1" });
    expect(moved.entry).toMatchObject({ id: "rule-3", section: "once", source: SOURCE });
    await expect(putEntry(repo, OPERATOR, bare)).rejects.toThrow(NEEDS_SOURCE);
    await expect(putEntry(repo, OPERATOR, { ...bare, source: SOURCE })).resolves.toMatchObject({ entry: { section: "once" } });
  });

  test("are asked of a rule that replaces an older one that has none, since it cannot inherit one", async () => {
    const { repo, root } = await makeTracked();
    await writeLegacyRule(root);

    await expect(putEntry(repo, OPERATOR, { kind: "rule", title: "keep it simple", text: "still", replaces: "rule-1", source: SOURCE })).rejects.toThrow(NEEDS_SECTION);
    const { entry } = await putEntry(repo, OPERATOR, { kind: "rule", title: "keep it simple", text: "still", replaces: "rule-1", source: SOURCE, section: "working" });

    expect(entry).toMatchObject({ id: "rule-2", section: "working" });
    expect((await readKind(repo, "rule")).entries[0]).toMatchObject({ id: "rule-1", retiredWhy: "replaced by rule-2" });
  });

  test("do not stop a rule written before them from being read, and it has neither", async () => {
    const { repo, root } = await makeTracked();
    await writeLegacyRule(root);

    const { entries } = await readKind(repo, "rule");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "rule-1", title: "keep it simple" });
    expect(entries[0]).not.toHaveProperty("section");
    expect(entries[0]).not.toHaveProperty("source");
  });

  test("a rule that replaces a finding takes no section from it, and one that replaces a rule keeps the writer's own words", async () => {
    const { repo } = await makeTracked();
    await putEntry(repo, DATA, { kind: "finding", title: "tests run frozen", text: "the clock is injected" }, NINE);

    await expect(putEntry(repo, OPERATOR, { kind: "rule", title: "freeze the clock", text: "in every test", replaces: "finding-1", source: SOURCE })).rejects.toThrow(NEEDS_SECTION);
    const { entry } = await putEntry(repo, OPERATOR, { kind: "rule", title: "freeze the clock", text: "in every test", replaces: "finding-1", source: SOURCE, section: "working" }, NINE);

    expect(entry).toMatchObject({ id: "rule-1", section: "working", replaces: "finding-1" });
    expect(entry).not.toHaveProperty("template");
  });
});
