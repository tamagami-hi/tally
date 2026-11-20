import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { serving, sessionOn } from "./support/calling.ts";

interface Board {
  rows: { id: string; track: string; finished: boolean; tasks: { id: string; track: string }[] }[];
  tracks: { track: string; branch: string }[];
  claims: { task: string; track: string }[];
}

async function busy() {
  const made = await makeTracked();
  const ui = join(made.root, ".temp", "worktrees", "ui");
  await sh(made.root, ["worktree", "add", "-q", ui, "-b", "feature/ui-work", "main"]);
  const tracks = [...made.repo.config.tracks, { name: "ui", worktree: ".temp/worktrees/ui", branch: "feature/ui-work" }];
  const call = await serving({ ...made.repo, config: { ...made.repo.config, tracks } });
  const data = await sessionOn(call, made.trees["data"]!);
  const engine = await sessionOn(call, made.trees["engine"]!, "e");
  const operator = await sessionOn(call, made.root, "op");
  const page = await sessionOn(call, ui, "u");
  await call("milestone_add", { sessionId: operator, id: "B3", stage: "B", name: "pages", track: "ui", weight: 1 });
  await call("task_plan", { sessionId: page, milestone: "B3", tasks: ["1 page"] });
  await call("task_claim", { sessionId: data, milestone: "B2", task: "4 manifest" });
  await call("task_claim", { sessionId: engine, milestone: "B2", task: "T9 store" });
  await call("task_claim", { sessionId: page, milestone: "B3", task: "1 page" });
  await writeFile(join(made.trees["data"]!, "open.rs"), "x\n");
  return { ...made, call, data, engine, page };
}

describe("board_get with scope mine", () => {
  test("returns only the session's track's rows and tasks, its branch beside main, and its claims", async () => {
    const { call, engine } = await busy();

    const mine = (await call("board_get", { scope: "mine", sessionId: engine })).structured as unknown as Board;
    const all = (await call("board_get")).structured as unknown as Board;

    expect(mine.rows.map((row) => [row.id, row.tasks.map((task) => task.id)])).toEqual([["B2", ["T9 store"]]]);
    expect(mine.tracks.map((track) => track.branch)).toEqual(["main", "track/engine"]);
    expect(mine.claims).toMatchObject([{ task: "T9 store", track: "engine" }]);
    expect(all.rows.map((row) => row.id)).toEqual(["B2", "B3"]);
    expect(all.tracks.map((track) => track.branch)).toEqual(["main", "feature/ui-work", "track/data", "track/engine"]);
    expect(all.claims).toHaveLength(3);
  });

  test("finds the session's branch when it is not named after the track", async () => {
    const { call, page } = await busy();

    const mine = (await call("board_get", { scope: "mine", sessionId: page })).structured as unknown as Board;

    expect(mine.rows.map((row) => row.id)).toEqual(["B3"]);
    expect(mine.tracks.map((track) => track.branch)).toEqual(["main", "feature/ui-work"]);
    expect(mine.claims).toMatchObject([{ task: "1 page", track: "ui" }]);
  });
});

describe("board_get's rows", () => {
  test("each say whether the milestone is finished, in the whole board and in the session's slice", async () => {
    const { call, engine } = await busy();

    const all = (await call("board_get")).structured as unknown as Board;
    const mine = (await call("board_get", { scope: "mine", sessionId: engine })).structured as unknown as Board;

    expect(all.rows.map((row) => [row.id, row.finished])).toEqual([["B2", false], ["B3", false]]);
    expect(mine.rows.map((row) => [row.id, row.finished])).toEqual([["B2", false]]);
  });
});

describe("board_get fields", () => {
  test("keeps only the named top-level keys, of the whole board or of the session's slice", async () => {
    const { call, engine } = await busy();

    const slim = await call("board_get", { fields: ["overall", "claims"] });
    const mine = await call("board_get", { scope: "mine", sessionId: engine, fields: ["claims", "rows"] });

    expect(Object.keys(slim.structured).sort()).toEqual(["claims", "overall"]);
    expect(slim.structured["claims"]).toHaveLength(3);
    expect(JSON.parse(slim.text)).toStrictEqual(slim.structured);
    expect(Object.keys(mine.structured).sort()).toEqual(["claims", "rows"]);
    expect(mine.structured["claims"]).toHaveLength(1);
  });

  test("refuses a key the board does not have, naming the ones it has", async () => {
    const { call } = await busy();

    const refused = await call("board_get", { fields: ["rows", "milestones"] });
    const inherited = await call("board_get", { fields: ["constructor"] });

    expect(inherited.isError).toBe(true);
    expect(inherited.text).toMatch(/^the board has no 'constructor'; its keys: name, /);
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("the board has no 'milestones'; its keys: name, time, overall, stagePct, stages, rows, tracks, main, origin, unpushed, today, questions, nextRow, problems, claims, locks, cycle");
  });
});
