import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { serving, sessionOn } from "./support/calling.ts";

const COVERED = "the ledger covers every commit on main";
const OWED = "B2 delivers 'index' (the index), and no task covers it: plan a task that covers it with task_plan";
const WAIT = "B2 'T9 store' waits on B7:grid, which is not a task in the ledger: plan it with task_plan, or clear the wait with task_unwait";
const ADRIFT = "B2 '4 manifest' landed without 'the docs' and names no task to finish it: record it again with task_land, the part left to a task";
const NOWHERE = "B2 '4 manifest' left 'the cache' to B2:9 cache, which is not a task in the ledger: plan it with task_plan";

async function commitOnMain(root: string, files: string[], subject: string): Promise<string> {
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), "x\n");
  }
  await sh(root, ["add", "--", ...files]);
  await sh(root, ["commit", "-q", "-m", subject]);
  return sh(root, ["rev-parse", "--short=7", "HEAD"]);
}

async function gapped() {
  const made = await makeTracked();
  const tracks = made.repo.config.tracks.map((track) => (track.name === "data" ? { ...track, paths: ["src/data"] } : track));
  const call = await serving({ ...made.repo, config: { ...made.repo.config, tracks } });
  const data = await sessionOn(call, made.trees["data"]!);
  const engine = await sessionOn(call, made.trees["engine"]!, "e");
  const operator = await sessionOn(call, made.root, "op");
  const landedAt = await commitOnMain(made.root, ["src/data/manifest.rs"], "feat(data): manifest");
  await call("milestone_deliver", { sessionId: operator, milestone: "B2", delivers: [{ id: "manifest", what: "the manifest file" }, { id: "index", what: "the index" }] });
  await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "4 manifest", covers: ["manifest"] }] });
  await call("task_land", { sessionId: data, milestone: "B2", task: "4 manifest", commit: landedAt, deferred: [{ what: "the docs" }, { what: "the cache", to: "B2:9 cache" }, { what: "the checksum", to: "B2:5 transcoder" }] });
  await call("task_wait", { sessionId: engine, milestone: "B2", task: "T9 store", what: "the grid", on: "B7:grid" });
  const mine = `${await commitOnMain(made.root, ["src/data/a.rs"], "feat(data): a")} feat(data): a`;
  const theirs = `${await commitOnMain(made.root, ["src/engine/b.rs"], "feat(engine): b")} feat(engine): b`;
  const shared = `${await commitOnMain(made.root, ["src/data/c.rs", "src/engine/c.rs"], "feat: both")} feat: both`;
  return { ...made, call, data, engine, operator, lines: { mine, theirs, shared } };
}

const answered = (call: { structured: Record<string, unknown> }): Record<string, unknown> => Object.fromEntries(Object.entries(call.structured).filter(([key]) => key !== "recordsWaiting"));

describe("ledger_check and the gaps", () => {
  test("a ledger with none answers as before, with an empty list of gaps", async () => {
    const { repo } = await makeTracked();
    const call = await serving(repo);

    const check = await call("ledger_check");

    expect(answered(check)).toStrictEqual({ missing: [], covered: true, gaps: [] });
    expect(check.text).toBe(COVERED);
  });

  test("lists every gap as a sentence, beside the commits no record names, in the answer and in its text", async () => {
    const { call, lines } = await gapped();

    const check = await call("ledger_check");

    expect(answered(check)).toStrictEqual({ missing: [lines.shared, lines.theirs, lines.mine], covered: false, gaps: [OWED, ADRIFT, NOWHERE, WAIT] });
    expect(check.text).toBe([lines.shared, lines.theirs, lines.mine, OWED, ADRIFT, NOWHERE, WAIT].join("\n"));
  });

  test("a gap goes once it is closed: the deliverable covered, the wait cleared, the part given a task that is there", async () => {
    const { call, data, engine, root } = await gapped();
    const landedAt = await sh(root, ["rev-parse", "--short=7", "HEAD~3"]);

    await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "9 cache", covers: ["index"] }] });
    await call("task_unwait", { sessionId: engine, milestone: "B2", task: "T9 store" });
    await call("task_land", { sessionId: data, milestone: "B2", task: "4 manifest", commit: landedAt, deferred: [{ what: "the docs", to: "B2:9 cache" }, { what: "the cache", to: "B2:9 cache" }] });

    expect((await call("ledger_check")).structured["gaps"]).toEqual([]);
  });
});

describe("ledger_check with scope mine", () => {
  test("needs the session", async () => {
    const { call } = await gapped();

    const refused = await call("ledger_check", { scope: "mine" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("scope 'mine' needs the sessionId");
  });

  test("keeps the track's own gaps, and the commits whose files are all under the track's paths", async () => {
    const { call, data, lines } = await gapped();

    const check = await call("ledger_check", { scope: "mine", sessionId: data });

    expect(answered(check)).toStrictEqual({ missing: [lines.mine], covered: false, gaps: [OWED, ADRIFT, NOWHERE] });
    expect(check.text).toBe([lines.mine, OWED, ADRIFT, NOWHERE].join("\n"));
  });

  test("leaves the commits as they are for a track with no paths, and says so in a note", async () => {
    const { call, engine, lines } = await gapped();
    const note = "track engine has no paths in the config, so missing lists every commit on main no record names, not only engine's";

    const check = await call("ledger_check", { scope: "mine", sessionId: engine });

    expect(answered(check)).toStrictEqual({ missing: [lines.shared, lines.theirs, lines.mine], covered: false, gaps: [OWED, WAIT], note });
    expect(check.text.split("\n").at(-1)).toBe(note);
  });

  test("scope all with a session is the whole check", async () => {
    const { call, data } = await gapped();

    expect((await call("ledger_check", { scope: "all", sessionId: data })).structured).toStrictEqual((await call("ledger_check")).structured);
  });
});
