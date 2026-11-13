import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { putEntry } from "../../src/context/entries.ts";
import { commitRecords, flushRecords, flushWhenFree, recordsMode } from "../../src/records/commit.ts";
import { commitWaitingRecords, recordsWaiting } from "../../src/records/waiting.ts";
import { endSession } from "../../src/state/end.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { busyLock } from "../support/busy.ts";
import { DATA, OPERATOR } from "../support/context.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const ATS_PHASE = { commit: true, batch: true, commitAt: "phase" as const };
const finding = { kind: "finding" as const, title: "one", text: "two" };

async function settled(records: Parameters<typeof makeTracked>[0]) {
  const made = await makeTracked(records);
  await sh(made.root, ["add", "-A", "docs/records"]);
  await sh(made.root, ["commit", "-q", "--allow-empty", "-m", "records: settle"]);
  return made;
}

const count = (root: string): Promise<string> => sh(root, ["rev-list", "--count", "HEAD"]);

describe("the records mode", () => {
  test.each([
    [{ commit: false }, "never"],
    [{ commit: false, batch: true, commitAt: "phase" }, "never"],
    [{ commit: true }, "each"],
    [{ commit: true, batch: false, commitAt: "phase" }, "each"],
    [{ commit: true, batch: true }, "rest"],
    [{ commit: true, batch: true, commitAt: "phase" }, "phase"],
  ])("%j is %s", (records, mode) => {
    expect(recordsMode({ records: { dir: "docs/records", commitPrefix: "records:", ...records } } as never)).toBe(mode);
  });

  test("a config with only batch, as the first tracked repository has, is the rest mode that was always there", () => {
    expect(recordsMode({ records: { dir: "d", commitPrefix: "r:", commit: true, batch: true } })).toBe("rest");
  });
});

describe("in the phase mode", () => {
  test("a write leaves the records on disk and git log as it was", async () => {
    const { repo, root } = await settled(ATS_PHASE);
    const before = await count(root);

    const written = await putEntry(repo, DATA, finding);

    expect(written.commit).toBeNull();
    expect(await count(root)).toBe(before);
    expect(await sh(root, ["status", "--porcelain"])).toContain("docs/records/context/");
  });

  test("the last session closing commits nothing", async () => {
    const { repo, root, trees } = await settled(ATS_PHASE);
    const session = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
    await putEntry(repo, DATA, finding);
    const before = await count(root);

    const ended = await endSession(repo, session.id);

    expect(ended.recordsCommit).toBeNull();
    expect(await count(root)).toBe(before);
  });

  test("the flush that follows a landing and a write with no session open commits nothing", async () => {
    const { repo, root } = await settled(ATS_PHASE);
    await putEntry(repo, DATA, finding);
    const before = await count(root);

    expect(await flushWhenFree(repo)).toBeNull();

    expect(await count(root)).toBe(before);
  });

  test("an explicit flush, as `tally records commit` makes, still commits", async () => {
    const { repo, root } = await settled(ATS_PHASE);
    await putEntry(repo, DATA, finding);

    expect(await flushRecords(repo)).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });

  test("in the rest mode the same flush still commits when the last session closes", async () => {
    const { repo, root, trees } = await makeTracked({ commit: true, batch: true });
    const session = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
    await putEntry(repo, DATA, finding);
    const before = Number(await count(root));

    const ended = await endSession(repo, session.id);

    expect(ended.recordsCommit).toMatch(/^[0-9a-f]{7}$/);
    expect(Number(await count(root))).toBe(before + 1);
  });

  test("each mode commits at each write, as before", async () => {
    const { repo, root } = await makeTracked({ commit: true });
    const before = Number(await count(root));

    const written = await putEntry(repo, DATA, finding);

    expect(written.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(Number(await count(root))).toBe(before + 1);
    expect(await commitRecords(repo, "nothing")).toBeNull();
  });
});

describe("commitWaitingRecords", () => {
  test("commits what waits as one commit, with the number of files and why in the subject", async () => {
    const { repo, root } = await settled(ATS_PHASE);
    await putEntry(repo, DATA, finding);
    await putEntry(repo, DATA, { ...finding, kind: "convention" });

    const done = await commitWaitingRecords(repo, OPERATOR, "before the operator pushes");

    expect(done).toMatchObject({ files: 2 });
    expect(done.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: 2 record files, before the operator pushes");
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });

  test("answers no commit and no files when nothing waits, which is not an error", async () => {
    const { repo, root } = await settled(ATS_PHASE);
    const before = await count(root);

    expect(await commitWaitingRecords(repo, OPERATOR, "why")).toEqual({ commit: null, files: 0 });
    expect(await count(root)).toBe(before);
  });

  test("folds a line break in why, so it can never add a line to the subject", async () => {
    const { repo, root } = await settled(ATS_PHASE);
    await putEntry(repo, DATA, finding);

    await commitWaitingRecords(repo, OPERATOR, "  before the\n\npush  ");

    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: 1 record file, before the push");
    expect(await sh(root, ["log", "-1", "--format=%b"])).toBe("");
  });

  test("is refused to a track session, where tally's commits are off, and for a why that is empty", async () => {
    const phase = await settled(ATS_PHASE);
    const off = await makeTracked({ commit: false });

    await expect(commitWaitingRecords(phase.repo, DATA, "why")).rejects.toThrow("only an operator session commits the waiting records; a track that wants them committed asks a question with question_add");
    await expect(commitWaitingRecords(off.repo, OPERATOR, "why")).rejects.toThrow("this repository turned tally's records commits off (records.commit is false); commit docs/records/ yourself, or turn them on with repo_configure");
    await expect(commitWaitingRecords(phase.repo, OPERATOR, " \n ")).rejects.toThrow("committing the records needs a why, in a line");
  });

  test("waits, and says so, while a landing has its turn", async () => {
    const { repo, root } = await settled(ATS_PHASE);
    await putEntry(repo, DATA, finding);
    busyLock("landing.lock");
    const before = await count(root);

    const done = await commitWaitingRecords(repo, OPERATOR, "why");

    expect(done).toMatchObject({ commit: null, waits: true });
    expect(await count(root)).toBe(before);
  });
});

describe("what waits", () => {
  test("is the files under docs/records that differ from HEAD, with the date of the last records commit", async () => {
    const { repo, root } = await settled(ATS_PHASE);
    await sh(root, ["commit", "-q", "--allow-empty", "-m", "records: earlier"]);
    await putEntry(repo, DATA, finding);
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "abc1234", note: "x" }] }, message: "x" }));
    await writeFile(join(root, "stray.txt"), "not records");

    const waiting = await recordsWaiting(repo);

    expect(waiting.files).toBe(2);
    expect(waiting.since).toBe(await sh(root, ["log", "-1", "--format=%cI", "--grep=^records:"]));
  });

  test("is no file, and the date of the last records commit, once they are committed", async () => {
    const { repo } = await settled(ATS_PHASE);
    await putEntry(repo, DATA, finding);
    await commitWaitingRecords(repo, OPERATOR, "why");

    expect((await recordsWaiting(repo)).files).toBe(0);
  });
});
