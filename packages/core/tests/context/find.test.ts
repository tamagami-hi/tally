import { describe, expect, test } from "vitest";
import { putEntry, retireEntry } from "../../src/context/entries.ts";
import { findEntries } from "../../src/context/find.ts";
import type { Repo } from "../../src/store/records.ts";
import { makeTracked } from "../support/tracked.ts";

const DATA = { track: "data", agent: "claude" };
const OPERATOR = { track: "main", agent: "operator" };
const at = (hour: number): Date => new Date(`2026-11-12T${String(hour).padStart(2, "0")}:00:00Z`);

async function filled(): Promise<Repo> {
  const { repo } = await makeTracked();
  await putEntry(repo, OPERATOR, { kind: "rule", title: "Never push main", text: "pushing is the operator's" }, at(1));
  await putEntry(repo, DATA, { kind: "area", title: "the store", text: "where the records are kept", paths: ["src/store"], tags: ["Store", "records"] }, at(2));
  await putEntry(repo, DATA, { kind: "howto", title: "run the tests", text: "npm test runs VITEST", paths: ["**/*.test.ts"], tags: ["tests"] }, at(3));
  await putEntry(repo, DATA, { kind: "finding", title: "the lock is a folder", text: "it holds no file", paths: ["src/store/lock.ts"], tags: ["store"] }, at(4));
  await putEntry(repo, DATA, { kind: "finding", title: "the web build is slow", text: "it takes a minute", paths: ["web/*"] }, at(5));
  await retireEntry(repo, DATA, "finding-2", "it was sped up", at(6));
  return repo;
}

const ids = async (repo: Repo, filter: Parameters<typeof findEntries>[1]): Promise<string[]> => (await findEntries(repo, filter)).entries.map((entry) => entry.id);

describe("finding context entries", () => {
  test("answers the entries in force, the newest first, and leaves retired ones out", async () => {
    const repo = await filled();

    const found = await findEntries(repo);

    expect(found.entries.map((entry) => entry.id)).toEqual(["finding-1", "howto-1", "area-1", "rule-1"]);
    expect(found.matched).toBe(4);
  });

  test("by ids answers them whether retired or not", async () => {
    const repo = await filled();

    expect(await ids(repo, { ids: ["finding-2", "rule-1", "area-9"] })).toEqual(["finding-2", "rule-1"]);
  });

  test("narrows by kind, by any of the tags, and by words in the title or the text, whatever their case", async () => {
    const repo = await filled();

    expect(await ids(repo, { kind: "finding" })).toEqual(["finding-1"]);
    expect(await ids(repo, { tags: ["STORE", "nothing"] })).toEqual(["finding-1", "area-1"]);
    expect(await ids(repo, { query: "vitest" })).toEqual(["howto-1"]);
    expect(await ids(repo, { query: "THE STORE" })).toEqual(["area-1"]);
    expect(await ids(repo, { kind: "area", query: "lock" })).toEqual([]);
  });

  test("by paths keeps what applies to one of the files, and what is project-wide", async () => {
    const repo = await filled();

    expect(await ids(repo, { paths: ["src/store/lock.ts"] })).toEqual(["finding-1", "area-1", "rule-1"]);
    expect(await ids(repo, { paths: ["src/store/json.ts", "tests/a.test.ts"] })).toEqual(["howto-1", "area-1", "rule-1"]);
    expect(await ids(repo, { paths: ["README.md"] })).toEqual(["rule-1"]);
    expect(await ids(repo, { paths: ["src/"] })).toEqual(["finding-1", "howto-1", "area-1", "rule-1"]);
  });

  test("since keeps what was added or retired after it, the retired with it, so a reader learns of a retirement", async () => {
    const repo = await filled();

    const found = await findEntries(repo, { since: "2026-11-12T03:30:00Z" });

    expect(found.entries.map((entry) => [entry.id, entry.retiredWhy])).toEqual([["finding-2", "it was sped up"], ["finding-1", undefined]]);
    expect(await ids(repo, { since: "2026-11-12T11:30:00+05:30" })).toEqual([]);
    expect(await ids(repo, { since: "2026-11-12T11:29:00+05:30" })).toEqual(["finding-2"]);
    await expect(findEntries(repo, { since: "yesterday" })).rejects.toThrow("since must be an ISO time such as 2026-11-12T09:00:00Z, not 'yesterday'");
  });

  test("limit keeps the newest and says how many matched", async () => {
    const repo = await filled();

    const found = await findEntries(repo, { limit: 2 });

    expect(found.entries.map((entry) => entry.id)).toEqual(["finding-1", "howto-1"]);
    expect(found.matched).toBe(4);
    await expect(findEntries(repo, { limit: 0 })).rejects.toThrow("limit must be a whole number above zero, not 0");
  });
});
