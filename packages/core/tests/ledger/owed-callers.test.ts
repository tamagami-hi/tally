import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkLedger } from "../../src/ledger/audit.ts";
import { contextOf } from "../../src/phases/blockers.ts";
import { unrecordedNow } from "../../src/state/inbox-ledger.ts";
import { openSession } from "../../src/state/sessions.ts";
import { collect } from "../../src/status/collect.ts";
import { Records } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

async function commit(root: string, file: string, subject: string): Promise<string> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), `${subject}\n`);
  await sh(root, ["add", "--", file]);
  await sh(root, ["commit", "-q", "-m", subject]);
  return sh(root, ["rev-parse", "--short=7", "HEAD"]);
}

async function swept() {
  const tracked = await makeTracked();
  const log = await commit(tracked.root, "docs/records/log/2026-11-12.json", "chore(main): update working tree");
  const code = await commit(tracked.root, "src/data/a.rs", "feat(data): a");
  return { ...tracked, log, code, ledger: await new Records(tracked.repo).readLedger() };
}

describe("a commit of records only, wherever the ledger is checked", () => {
  test("ledger_check's answer leaves it out of missing, shows it in passed and says so in one line", async () => {
    const { repo, ledger, log, code } = await swept();

    const { check, text } = await checkLedger(repo, ledger);

    expect(check.missing).toEqual([`${code} feat(data): a`]);
    expect(check.passed).toStrictEqual({ total: 1, shown: [{ commit: log, subject: "chore(main): update working tree", why: "records only" }] });
    expect(text.split("\n")).toEqual([`${code} feat(data): a`, "the check passes over 1 commit on main that changes only files under docs/records"]);
  });

  test("a covered ledger keeps its line, and the passed line follows it", async () => {
    const tracked = await makeTracked();
    await commit(tracked.root, "docs/records/log/2026-11-12.json", "chore: one");
    await commit(tracked.root, "docs/records/log/2026-11-13.json", "chore: two");

    const { check, text } = await checkLedger(tracked.repo, await new Records(tracked.repo).readLedger());

    expect(check).toMatchObject({ missing: [], covered: true, passed: { total: 2 } });
    expect(text).toBe("the ledger covers every commit on main\nthe check passes over 2 commits on main that change only files under docs/records");
  });

  test("shows the newest ten and counts them all", async () => {
    const tracked = await makeTracked();
    const made: string[] = [];
    for (let day = 10; day <= 21; day += 1) made.push(await commit(tracked.root, `docs/records/log/2026-11-${day}.json`, `chore: day ${day}`));

    const { check } = await checkLedger(tracked.repo, await new Records(tracked.repo).readLedger());

    expect(check.passed.total).toBe(12);
    expect(check.passed.shown.map((one) => one.commit)).toEqual(made.slice(2).reverse());
  });

  test("a track's check passes over it as well", async () => {
    const { repo, ledger, log } = await swept();
    const withPaths = { ...repo, config: { ...repo.config, tracks: repo.config.tracks.map((track) => (track.name === "data" ? { ...track, paths: ["src/data"] } : track)) } };

    const { check } = await checkLedger(withPaths, ledger, "data");

    expect(check.missing).toHaveLength(1);
    expect(check.passed.shown.map((one) => one.commit)).toEqual([log]);
  });

  test("the status's problems name only the commit that changes code", async () => {
    const { repo, ledger, code } = await swept();

    const status = await collect(repo, ledger);

    expect(status.problems.filter((problem) => problem.startsWith("commits on main"))).toEqual([`commits on main not in the ledger (record them): ${code} feat(data): a`]);
  });

  test("the inbox tells a session about the commit that changes code alone", async () => {
    const { repo, root, code } = await swept();
    const session = await openSession(repo, { worktree: root, agent: "op" });

    expect(await unrecordedNow(repo, session)).toEqual([`${code} feat(data): a`]);
  });

  test("a phase's close is not held back by it", async () => {
    const { repo, ledger, code } = await swept();

    const context = await contextOf(repo, ledger);

    expect(context.missing).toEqual([`${code} feat(data): a`]);
  });
});
