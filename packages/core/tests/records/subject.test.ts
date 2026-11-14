import { describe, expect, test } from "vitest";
import { commitStaged, fittedSubject, MOST_SUBJECT } from "../../src/records/commit.ts";
import { unrecorded } from "../../src/ledger/check.ts";
import { logLines } from "../../src/git/refs.ts";
import { Records } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const PREFIX = "records:";
const SEEN = "4 record files, end of the spring build session: Q-12 answered as DEC-9 after the phase was closed";

describe("a records commit's subject", () => {
  test("is kept as it is when it fits in 70 characters with the prefix", () => {
    expect(fittedSubject(PREFIX, "B2 'done': landed at abc1234")).toEqual({ subject: "records: B2 'done': landed at abc1234" });
  });

  test("is cut at the last ': ' or ', ' that keeps it within the limit, the whole sentence kept for the body", () => {
    const fitted = fittedSubject(PREFIX, SEEN);

    expect(fitted).toEqual({ subject: "records: 4 record files, end of the spring build session", moved: SEEN });
    expect(fitted.subject.length).toBeLessThanOrEqual(MOST_SUBJECT);
  });

  test("cuts a long answer at 'answered', and at the last space when there is no ': ' or ', '", () => {
    expect(fittedSubject(PREFIX, `Q-24 answered: ${"keep the reader as one process and revisit it after the load test".repeat(2)}`).subject).toBe("records: Q-24 answered");
    expect(fittedSubject(PREFIX, `${"word ".repeat(30)}end`).subject).toBe(`records: ${"word ".repeat(12).trimEnd()}`);
  });
});

describe("a records commit with a long subject", () => {
  test("has a subject of at most 70, the prefix first, and a body that starts with the whole sentence before the caller's own", async () => {
    const { repo, root } = await makeTracked({ commit: true });
    const why = `the end of the build session, ${"w".repeat(170)}`;
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "abc1234", note: "x" }] }, message: "x" }));

    await commitStaged(repo, (files) => `${files} record file${files === 1 ? "" : "s"}, ${why}`, "the caller's body");

    const subject = await sh(root, ["log", "-1", "--format=%s"]);
    const body = await sh(root, ["log", "-1", "--format=%b"]);
    expect(subject).toBe("records: 1 record file, the end of the build session");
    expect(body).toBe(`1 record file, ${why}\n\nthe caller's body`);
    const ledger = await new Records(repo).readLedger();
    expect(unrecorded(ledger, await logLines(root, `${ledger.baseline}..main`), PREFIX)).toEqual([]);
  });
});

describe("a records commit's subject at its edges", () => {
  test("keeps exactly 70 characters, cuts 71, and uses a ', ' that starts right at the limit", () => {
    const seventy = `x${"y".repeat(60)}`;
    expect(fittedSubject(PREFIX, seventy).subject).toHaveLength(MOST_SUBJECT);
    expect(fittedSubject(PREFIX, `${seventy}z`).subject.length).toBeLessThanOrEqual(MOST_SUBJECT);
    expect(fittedSubject(PREFIX, `${"a".repeat(30)} ${"b".repeat(30)}, then more`).subject).toBe(`records: ${"a".repeat(30)} ${"b".repeat(30)}`);
  });

  test("never cuts into the prefix, and never splits a character in two", () => {
    expect(fittedSubject(PREFIX, "z".repeat(90)).subject.startsWith(`${PREFIX} `)).toBe(true);
    expect(fittedSubject("p".repeat(75), "word").subject).toBe("p".repeat(75));
    const cut = fittedSubject(PREFIX, `${"a".repeat(60)}😀😀😀`).subject;
    expect(cut.isWellFormed()).toBe(true);
  });

  test("folds the subject's line breaks, and keeps the whole sentence as it was for the body", () => {
    const text = "Q-1 answered: yes\n\nbecause a, b and c hold for every segment we have, and more besides";

    const fitted = fittedSubject(PREFIX, text);

    expect(fitted.subject).not.toContain("\n");
    expect(fitted.moved).toBe(text);
  });
});
