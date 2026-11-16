import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { RECORDS_ONLY, owedCommits } from "../../src/ledger/owed.ts";
import { Records } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const LOG_FILE = "docs/records/log/2026-11-12.json";

async function commit(root: string, files: string[], subject: string, extra: string[] = []): Promise<string> {
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), `${subject}\n`);
  }
  if (files.length > 0) await sh(root, ["add", "--", ...files]);
  await sh(root, ["commit", "-q", ...extra, "-m", subject]);
  return sh(root, ["rev-parse", "--short=7", "HEAD"]);
}

async function sweep(root: string, file: string, subject: string): Promise<string> {
  await sh(root, ["add", "--", file]);
  await sh(root, ["commit", "-q", "-m", subject]);
  return sh(root, ["rev-parse", "--short=7", "HEAD"]);
}

async function owed(root: string, tracked: Awaited<ReturnType<typeof makeTracked>>) {
  return owedCommits(tracked.repo, await new Records(tracked.repo).readLedger());
}

describe("which commits on main the ledger still owes", () => {
  test("a commit with another subject that changes only a log file is passed over, as records only", async () => {
    const tracked = await makeTracked();
    const swept = await commit(tracked.root, [LOG_FILE], "chore(main): update working tree");

    const found = await owed(tracked.root, tracked);

    expect(found).toStrictEqual({ missing: [], passed: [{ commit: swept, subject: "chore(main): update working tree", why: RECORDS_ONLY }] });
    expect(RECORDS_ONLY).toBe("records only");
  });

  test("one that changes only the ledger is passed over too", async () => {
    const tracked = await makeTracked();
    const swept = await sweep(tracked.root, "docs/records/ledger.json", "chore: sweep the tree");

    const found = await owed(tracked.root, tracked);

    expect(found.passed.map((one) => one.commit)).toEqual([swept]);
    expect(found.missing).toEqual([]);
  });

  test("one that changes a record and a source file is still missing", async () => {
    const tracked = await makeTracked();
    const mixed = await commit(tracked.root, [LOG_FILE, "src/data/a.rs"], "feat(data): a, and the log");

    const found = await owed(tracked.root, tracked);

    expect(found).toStrictEqual({ missing: [`${mixed} feat(data): a, and the log`], passed: [] });
  });

  test("one that changes no file is still missing", async () => {
    const tracked = await makeTracked();
    const empty = await commit(tracked.root, [], "chore: nothing", ["--allow-empty"]);

    const found = await owed(tracked.root, tracked);

    expect(found).toStrictEqual({ missing: [`${empty} chore: nothing`], passed: [] });
  });

  test("a file beside the records folder whose name starts the same is not under it", async () => {
    const tracked = await makeTracked();
    const near = await commit(tracked.root, ["docs/records-old/ledger.json"], "chore: an old copy");

    const found = await owed(tracked.root, tracked);

    expect(found.missing).toEqual([`${near} chore: an old copy`]);
  });

  test("a merge is judged by what it brought to main, against its first parent", async () => {
    const tracked = await makeTracked();
    await sh(tracked.root, ["checkout", "-q", "-b", "side"]);
    const recordsOnly = await commit(tracked.root, [LOG_FILE], "chore: the log");
    await sh(tracked.root, ["checkout", "-q", "main"]);
    await commit(tracked.root, ["docs/records/notes.json"], "chore: notes");
    await sh(tracked.root, ["merge", "-q", "--no-ff", "-m", "Merge branch 'side'", "side"]);
    const merge = await sh(tracked.root, ["rev-parse", "--short=7", "HEAD"]);
    await sh(tracked.root, ["checkout", "-q", "-b", "code"]);
    const code = await commit(tracked.root, ["src/engine/b.rs"], "feat(engine): b");
    await sh(tracked.root, ["checkout", "-q", "main"]);
    await sh(tracked.root, ["merge", "-q", "--no-ff", "-m", "Merge branch 'code'", "code"]);
    const codeMerge = await sh(tracked.root, ["rev-parse", "--short=7", "HEAD"]);

    const found = await owed(tracked.root, tracked);

    expect(found.missing).toEqual([`${codeMerge} Merge branch 'code'`, `${code} feat(engine): b`]);
    expect(found.passed.map((one) => one.commit)).toEqual(expect.arrayContaining([merge, recordsOnly]));
    expect(found.passed).toHaveLength(3);
  });

  test("keeps main's order, newest first, in both lists", async () => {
    const tracked = await makeTracked();
    const first = await commit(tracked.root, [LOG_FILE], "chore: first");
    const code = await commit(tracked.root, ["src/data/a.rs"], "feat(data): a");
    const second = await sweep(tracked.root, "docs/records/ledger.json", "chore: second");

    const found = await owed(tracked.root, tracked);

    expect(found.passed.map((one) => one.commit)).toEqual([second, first]);
    expect(found.missing).toEqual([`${code} feat(data): a`]);
  });

  test("asks git about the files of the commits no record names, and of no other", async () => {
    const tracked = await makeTracked();
    const recorded = await commit(tracked.root, ["src/data/a.rs"], "feat(data): a");
    await commit(tracked.root, ["docs/records/x.json"], "records: by prefix");
    const owedOne = await commit(tracked.root, [LOG_FILE], "chore: the log");
    const records = new Records(tracked.repo);
    const ledger = await records.readLedger();
    const marked = { ...ledger, other: [{ commit: recorded, note: "a" }] };
    const asked: string[] = [];

    const found = await owedCommits(tracked.repo, marked, async (hash) => {
      asked.push(hash);
      return [LOG_FILE];
    });

    expect(asked).toEqual([owedOne]);
    expect(found.passed.map((one) => one.commit)).toEqual([owedOne]);
  });

  test("a clean ledger makes no call for files at all", async () => {
    const tracked = await makeTracked();
    const asked: string[] = [];

    const found = await owedCommits(tracked.repo, await new Records(tracked.repo).readLedger(), async (hash) => {
      asked.push(hash);
      return [];
    });

    expect(found).toStrictEqual({ missing: [], passed: [] });
    expect(asked).toEqual([]);
  });
});
