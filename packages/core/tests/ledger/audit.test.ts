import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkLedger } from "../../src/ledger/audit.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const NONE_PASSED = { total: 0, shown: [] };
const WAIT_GAP = "B2 'T9 store' waits on B7:grid, which is not a task in the ledger: plan it with task_plan, or clear the wait with task_unwait";
const OWED_GAP = "B2 delivers 'manifest' (the manifest file), and no task covers it: plan a task that covers it with task_plan";
const DEFERRED_GAP = "B2 'done' landed without 'the docs' and names no task to finish it: leave it to a task, or park it, with deferred_set";

async function commit(root: string, files: string[], subject: string): Promise<string> {
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), "x\n");
  }
  await sh(root, ["add", "--", ...files]);
  await sh(root, ["commit", "-q", "-m", subject]);
  return `${await sh(root, ["rev-parse", "--short=7", "HEAD"])} ${subject}`;
}

const withPaths = (repo: Repo): Repo => ({ ...repo, config: { ...repo.config, tracks: repo.config.tracks.map((track) => (track.name === "data" ? { ...track, paths: ["src/data", "docs/data.md"] } : track)) } });

async function gapped() {
  const tracked = await makeTracked();
  const repo = withPaths(tracked.repo);
  const records = new Records(repo);
  await records.update((ledger) => ({
    message: "gaps",
    ledger: { ...ledger, milestones: ledger.milestones.map((m) => ({ ...m, delivers: [{ id: "manifest", what: "the manifest file" }], tasks: m.tasks.map((t) => {
      if (t.id === "T9 store") return { ...t, waitsOn: [{ task: "B7:grid", what: "the grid" }] };
      return t.id === "done" ? { ...t, deferred: [{ what: "the docs" }] } : t;
    }) })) },
  }));
  await sh(tracked.root, ["add", "-A"]);
  await sh(tracked.root, ["commit", "-q", "-m", "records: gaps"]);
  const data = await commit(tracked.root, ["src/data/a.rs", "docs/data.md"], "feat(data): a");
  const engine = await commit(tracked.root, ["src/engine/b.rs"], "feat(engine): b");
  const both = await commit(tracked.root, ["src/data/c.rs", "src/engine/c.rs"], "feat: both");
  const near = await commit(tracked.root, ["src/database/d.rs"], "feat(database): d");
  return { repo, records, lines: { data, engine, both, near } };
}

describe("checking the ledger", () => {
  test("an old ledger that covers main answers as it always has, with no gaps", async () => {
    const { repo } = await makeTracked();

    const { check, text } = await checkLedger(repo, await new Records(repo).readLedger());

    expect(check).toStrictEqual({ missing: [], covered: true, passed: NONE_PASSED, gaps: [], parked: 0 });
    expect(text).toBe("the ledger covers every commit on main");
  });

  test("lists the commits no record names and every gap, each on its own line of the text", async () => {
    const { repo, records, lines } = await gapped();

    const { check, text } = await checkLedger(repo, await records.readLedger());

    expect(check).toStrictEqual({ missing: [lines.near, lines.both, lines.engine, lines.data], covered: false, passed: NONE_PASSED, gaps: [OWED_GAP, WAIT_GAP, DEFERRED_GAP], parked: 0 });
    expect(text).toBe([lines.near, lines.both, lines.engine, lines.data, OWED_GAP, WAIT_GAP, DEFERRED_GAP].join("\n"));
  });

  test("gaps do not change whether the commits are covered, and follow that line in the text", async () => {
    const { repo, records } = await gapped();
    const head = await sh(repo.root, ["rev-parse", "--short=7", "HEAD"]);
    await records.update((ledger) => ({ message: "baseline", ledger: { ...ledger, baseline: head } }));

    const { check, text } = await checkLedger(repo, await records.readLedger());

    expect(check).toMatchObject({ missing: [], covered: true });
    expect(text).toBe(["the ledger covers every commit on main", OWED_GAP, WAIT_GAP, DEFERRED_GAP].join("\n"));
  });
});

describe("checking only what is one track's", () => {
  test("keeps its gaps, and the commits whose files are all under its paths", async () => {
    const { repo, records, lines } = await gapped();

    const { check, text } = await checkLedger(repo, await records.readLedger(), "data");

    expect(check).toStrictEqual({ missing: [lines.data], covered: false, passed: NONE_PASSED, gaps: [OWED_GAP, DEFERRED_GAP], parked: 0 });
    expect(text).toBe([lines.data, OWED_GAP, DEFERRED_GAP].join("\n"));
  });

  test("a track with no paths in the config keeps every commit, and a note says so", async () => {
    const { repo, records, lines } = await gapped();
    const note = "track engine has no paths in the config, so missing lists every commit on main no record names, not only engine's";

    const { check, text } = await checkLedger(repo, await records.readLedger(), "engine");

    expect(check).toStrictEqual({ missing: [lines.near, lines.both, lines.engine, lines.data], covered: false, passed: NONE_PASSED, gaps: [OWED_GAP, WAIT_GAP], parked: 0, note });
    expect(text.split("\n").at(-1)).toBe(note);
  });

  test("says what it covers when none of the track's own commits is missing", async () => {
    const tracked = await makeTracked();
    const repo = withPaths(tracked.repo);
    await commit(tracked.root, ["src/engine/b.rs"], "feat(engine): b");

    const { check, text } = await checkLedger(repo, await new Records(repo).readLedger(), "data");

    expect(check).toStrictEqual({ missing: [], covered: true, passed: NONE_PASSED, gaps: [], parked: 0 });
    expect(text).toBe("the ledger covers every commit on main that changes only src/data, docs/data.md");
  });
});
