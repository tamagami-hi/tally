import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MAX_LISTED, MAX_NAMED, MAX_TEXT, MAX_TITLE, putEntry, readEntries, readKind, retireEntry } from "../../src/context/entries.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const DATA = { track: "data", agent: "claude" };
const ENGINE = { track: "engine", agent: "kiro" };
const OPERATOR = { track: "main", agent: "operator" };
const NINE = new Date("2026-11-12T09:00:00Z");
const TEN = new Date("2026-11-12T10:00:00Z");
const finding = (title: string) => ({ kind: "finding" as const, title, text: `${title}, in full` });

describe("context entries", () => {
  test("an entry takes its kind's next number, and is kept with who wrote it and when", async () => {
    const { repo, root } = await makeTracked();

    const first = await putEntry(repo, DATA, { ...finding("the store keys columns by id"), paths: ["./src/store/"], tags: ["store"], refs: ["B2"] }, NINE);
    const second = await putEntry(repo, ENGINE, finding("the clock is injected"), TEN);
    const area = await putEntry(repo, DATA, { kind: "area", title: "the store", text: "where records are kept" }, TEN);

    expect(first.entry).toEqual({ id: "finding-1", kind: "finding", title: "the store keys columns by id", text: "the store keys columns by id, in full", paths: ["src/store"], tags: ["store"], refs: ["B2"], by: DATA, at: "2026-11-12T09:00:00.000Z" });
    expect(second.entry).toMatchObject({ id: "finding-2", paths: [], tags: [], refs: [], by: ENGINE });
    expect(area.entry.id).toBe("area-1");
    expect(JSON.parse(await readFile(join(root, "docs/records/context/finding.json"), "utf8"))).toEqual({ schema: 1, kind: "finding", nextNumber: 3, entries: [first.entry, second.entry] });
  });

  test("reads as empty before anything is written", async () => {
    const { repo } = await makeTracked();

    expect(await readKind(repo, "howto")).toEqual({ schema: 1, kind: "howto", nextNumber: 1, entries: [] });
    expect(await readEntries(repo)).toEqual([]);
  });

  test("an entry that replaces another retires it, and the old one keeps its words", async () => {
    const { repo } = await makeTracked();
    await putEntry(repo, DATA, finding("the store keys columns by name"), NINE);

    const { entry, retired } = await putEntry(repo, ENGINE, { ...finding("the store keys columns by id"), replaces: "finding-1" }, TEN);

    expect(entry).toMatchObject({ id: "finding-2", replaces: "finding-1" });
    expect(retired).toMatchObject({ id: "finding-1", title: "the store keys columns by name", by: DATA, at: "2026-11-12T09:00:00.000Z", retiredAt: "2026-11-12T10:00:00.000Z", retiredWhy: "replaced by finding-2" });
    expect((await readKind(repo, "finding")).entries).toEqual([retired, entry]);
  });

  test("an entry of one kind may replace an entry of another", async () => {
    const { repo } = await makeTracked();
    await putEntry(repo, DATA, finding("tests run with the clock frozen"), NINE);

    const { entry } = await putEntry(repo, DATA, { kind: "convention", title: "freeze the clock in tests", text: "pass now to every writer", replaces: "finding-1" }, TEN);

    expect(entry).toMatchObject({ id: "convention-1", replaces: "finding-1" });
    expect((await readKind(repo, "finding")).entries[0]).toMatchObject({ retiredAt: "2026-11-12T10:00:00.000Z", retiredWhy: "replaced by convention-1" });
  });

  test("retiring sets the time and the reason, and a number is never taken twice", async () => {
    const { repo } = await makeTracked();
    await putEntry(repo, DATA, finding("one"), NINE);

    const { entry } = await retireEntry(repo, ENGINE, "finding-1", "the store was rewritten", TEN);
    const next = await putEntry(repo, DATA, finding("two"), TEN);

    expect(entry).toMatchObject({ id: "finding-1", title: "one", retiredAt: "2026-11-12T10:00:00.000Z", retiredWhy: "the store was rewritten" });
    expect(next.entry.id).toBe("finding-2");
  });

  test("refuses to retire or replace what is unknown, already retired, or no entry id, and adds nothing then", async () => {
    const { repo } = await makeTracked();
    await putEntry(repo, DATA, finding("one"), NINE);
    await retireEntry(repo, DATA, "finding-1", "wrong", TEN);

    await expect(retireEntry(repo, DATA, "finding-9", "x")).rejects.toThrow("no entry finding-9; context_get lists the entries");
    await expect(retireEntry(repo, DATA, "finding-1", "again")).rejects.toThrow("finding-1 was retired at 2026-11-12T10:00:00.000Z (wrong); nothing was changed");
    await expect(retireEntry(repo, DATA, "note-1", "x")).rejects.toThrow("'note-1' is not an entry's id; an id is a kind and a number, such as finding-3 (kinds: rule, convention, area, interface, howto, finding)");
    await expect(retireEntry(repo, DATA, "finding-1", "  ")).rejects.toThrow("retiring an entry needs the reason");
    await expect(putEntry(repo, DATA, { ...finding("two"), replaces: "finding-1" })).rejects.toThrow(/finding-1 was retired/);
    await expect(putEntry(repo, DATA, { kind: "area", title: "a", text: "b", replaces: "finding-7" })).rejects.toThrow(/no entry finding-7/);
    expect(await readKind(repo, "area")).toMatchObject({ nextNumber: 1, entries: [] });
    expect((await readKind(repo, "finding")).nextNumber).toBe(2);
  });

  test("a rule is written, replaced and retired only at operator scope", async () => {
    const { repo } = await makeTracked();
    const rule = { kind: "rule" as const, title: "never push main", text: "pushing is the operator's" };

    await expect(putEntry(repo, DATA, rule)).rejects.toThrow("only an operator session writes a rule; a track that wants one asks a question with question_add");
    const { entry } = await putEntry(repo, OPERATOR, rule, NINE);
    await expect(retireEntry(repo, DATA, "rule-1", "x")).rejects.toThrow(/only an operator session writes a rule/);
    await expect(putEntry(repo, DATA, { ...finding("a finding"), replaces: "rule-1" })).rejects.toThrow(/only an operator session writes a rule/);

    expect(entry).toMatchObject({ id: "rule-1", by: OPERATOR });
    expect((await readKind(repo, "rule")).entries).toEqual([entry]);
    expect((await retireEntry(repo, OPERATOR, "rule-1", "lifted", TEN)).entry.retiredWhy).toBe("lifted");
  });

  test("refuses a title or a text that is empty or too long, and a path that leaves the repository", async () => {
    const { repo } = await makeTracked();

    await expect(putEntry(repo, DATA, { kind: "finding", title: " ", text: "x" })).rejects.toThrow("an entry needs a title");
    await expect(putEntry(repo, DATA, { kind: "finding", title: "x", text: "\n" })).rejects.toThrow("an entry needs a text");
    await expect(putEntry(repo, DATA, { kind: "finding", title: "t".repeat(MAX_TITLE + 1), text: "x" })).rejects.toThrow("an entry's title holds at most 120 characters; this one has 121");
    await expect(putEntry(repo, DATA, { kind: "finding", title: "x", text: "t".repeat(MAX_TEXT + 1) })).rejects.toThrow("an entry's text holds at most 2000 characters; this one has 2001. A longer subject is several entries");
    await expect(putEntry(repo, DATA, { ...finding("x"), paths: ["/etc/passwd"] })).rejects.toThrow("an entry's path is a file, a folder or a glob from the repository's root; '/etc/passwd' is not");
    await expect(putEntry(repo, DATA, { ...finding("x"), paths: ["src/../../x"] })).rejects.toThrow(/'src\/\.\.\/\.\.\/x' is not/);
    await expect(putEntry(repo, DATA, { ...finding("x"), paths: ["."] })).rejects.toThrow(/'\.' is not/);
    expect((await putEntry(repo, DATA, { kind: "finding", title: "t".repeat(MAX_TITLE), text: "t".repeat(MAX_TEXT) })).entry.id).toBe("finding-1");
  });

  test("refuses more paths, tags or refs than an entry holds, one that is too long, and a reason that is, so an entry stays small", async () => {
    const { repo } = await makeTracked();
    const many = (word: string): string[] => Array.from({ length: MAX_LISTED + 1 }, (_, index) => `${word}${index}`);
    await putEntry(repo, DATA, finding("one"), NINE);

    await expect(putEntry(repo, DATA, { ...finding("x"), paths: many("src/") })).rejects.toThrow("an entry holds at most 20 paths; this one has 21");
    await expect(putEntry(repo, DATA, { ...finding("x"), tags: many("tag") })).rejects.toThrow("an entry holds at most 20 tags; this one has 21");
    await expect(putEntry(repo, DATA, { ...finding("x"), refs: many("B") })).rejects.toThrow("an entry holds at most 20 refs; this one has 21");
    await expect(putEntry(repo, DATA, { ...finding("x"), paths: [`src/${"a".repeat(MAX_NAMED)}`] })).rejects.toThrow("an entry's path holds at most 200 characters; this one has 204");
    await expect(putEntry(repo, DATA, { ...finding("x"), tags: ["t".repeat(MAX_NAMED + 1)] })).rejects.toThrow("an entry's tag holds at most 200 characters; this one has 201");
    await expect(retireEntry(repo, DATA, "finding-1", "w".repeat(MAX_TEXT + 1))).rejects.toThrow("the reason holds at most 2000 characters; this one has 2001");
    expect((await putEntry(repo, DATA, { ...finding("x"), tags: many("tag").slice(1), paths: ["a".repeat(MAX_NAMED)] })).entry.tags).toHaveLength(MAX_LISTED);
    expect((await readKind(repo, "finding")).entries.map((entry) => entry.retiredAt)).toEqual([undefined, undefined]);
  });

  test("writers at the same moment each take their own number", async () => {
    const { repo } = await makeTracked();

    const added = await Promise.all(["a", "b", "c", "d"].map((title) => putEntry(repo, DATA, finding(title))));

    expect(added.map(({ entry }) => entry.id).sort()).toEqual(["finding-1", "finding-2", "finding-3", "finding-4"]);
    expect((await readKind(repo, "finding")).entries).toHaveLength(4);
  });

  test("each write is a records commit where the config commits", async () => {
    const { repo, root } = await makeTracked({ commit: true });

    const added = await putEntry(repo, DATA, finding("one"), NINE);
    const subject = await sh(root, ["log", "-1", "--format=%s"]);
    const replaced = await putEntry(repo, DATA, { ...finding("two"), replaces: "finding-1" }, TEN);
    const retired = await retireEntry(repo, DATA, "finding-2", "gone", TEN);

    expect(added.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(subject).toBe("records: finding-1 added to the context by claude");
    expect(replaced.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(retired.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-2", "--format=%s"])).toBe("records: finding-2 retired from the context by claude\nrecords: finding-2 added to the context by claude, replacing finding-1");
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });
});
