import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { rowOf, serving, sessionOn, taskOf, type Call } from "./support/calling.ts";

async function tracked() {
  const made = await makeTracked();
  const call = await serving(made.repo);
  const data = await sessionOn(call, made.trees["data"]!);
  const engine = await sessionOn(call, made.trees["engine"]!, "e");
  const operator = await sessionOn(call, made.root, "op");
  return { ...made, call, data, engine, operator };
}

async function commitOnMain(root: string, file: string): Promise<string> {
  await writeFile(join(root, file), "x\n");
  await sh(root, ["add", "--", file]);
  await sh(root, ["commit", "-q", "-m", `feat: ${file}`]);
  return sh(root, ["rev-parse", "--short=7", "HEAD"]);
}

const owing = (call: Call, operator: string) => call("milestone_deliver", { sessionId: operator, milestone: "B2", delivers: [{ id: "manifest", what: "the manifest file", paths: ["src/manifest"] }, { id: "index", what: "the index" }] });

describe("what a milestone delivers, through the tools", () => {
  test("milestone_add keeps the deliverables it is given", async () => {
    const { call, operator } = await tracked();
    const delivers = [{ id: "grid", what: "the price grid", paths: ["src/grid"] }];

    const added = await call("milestone_add", { sessionId: operator, id: "B3", stage: "B", name: "grids", track: "data", weight: 1, delivers });

    expect(added.structured).toMatchObject({ message: "B3: added to stage B" });
    expect((await rowOf(call, "B3"))["delivers"]).toEqual(delivers);
  });

  test("milestone_deliver adds to a milestone that exists, for an operator session only, and refuses an id already there", async () => {
    const { call, operator, data } = await tracked();

    const refused = await call("milestone_deliver", { sessionId: data, milestone: "B2", delivers: [{ id: "manifest", what: "the manifest file" }] });
    const added = await owing(call, operator);
    const twice = await call("milestone_deliver", { sessionId: operator, milestone: "B2", delivers: [{ id: "index", what: "again" }] });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("only an operator session adds deliverables to a milestone");
    expect(added.structured).toMatchObject({ message: "B2: delivers 2 more: manifest, index", commit: null });
    expect(twice.text).toBe("B2 already delivers 'index'; give the new deliverable another id");
    expect((await rowOf(call, "B2"))["delivers"]).toEqual([{ id: "manifest", what: "the manifest file", paths: ["src/manifest"] }, { id: "index", what: "the index" }]);
  });
});

describe("task_plan with a task's details", () => {
  test("takes a task as a name or with its brief, paths and covers", async () => {
    const { call, operator, data } = await tracked();
    await owing(call, operator);

    const planned = await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 plain", { id: "7 index", brief: "build the index", paths: ["src/index"], covers: ["index"] }] });

    expect(planned.structured).toMatchObject({ message: "B2: planned 2 new task(s): 6 plain, 7 index" });
    expect(await taskOf(call, "B2", "6 plain")).toEqual({ id: "6 plain", track: "data", status: "planned", also: [] });
    expect(await taskOf(call, "B2", "7 index")).toEqual({ id: "7 index", track: "data", status: "planned", also: [], brief: "build the index", paths: ["src/index"], covers: ["index"] });
  });

  test("refuses to cover what the milestone does not deliver", async () => {
    const { call, operator, data } = await tracked();
    await owing(call, operator);

    const refused = await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "7 grid", covers: ["grid"] }] });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("B2 delivers no 'grid'; it delivers: manifest, index");
  });

  test("sets the details of a task the session's track already planned, and not another track's", async () => {
    const { call, operator, data } = await tracked();
    await owing(call, operator);

    const set = await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "4 manifest", covers: ["manifest"] }] });
    const foreign = await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "T9 store", covers: ["index"] }] });

    expect(set.structured).toMatchObject({ message: "B2: planned 0 new task(s); set the details of 4 manifest" });
    expect((await taskOf(call, "B2", "4 manifest"))["covers"]).toEqual(["manifest"]);
    expect(foreign.text).toBe("'T9 store' in B2 is track engine's task, so track data does not set its details");
  });
});

describe("waiting on a task, through the tools", () => {
  test("task_wait with `on` waits on that task, and landing it clears the wait and says so", async () => {
    const { call, root, data, engine } = await tracked();
    await call("task_unwait", { sessionId: engine, milestone: "B2", task: "T9 store" });

    const waited = await call("task_wait", { sessionId: engine, milestone: "B2", task: "T9 store", what: "the manifest's format", on: "B2:4 manifest" });
    const waiting = await rowOf(call, "B2");
    const sha = await commitOnMain(root, "manifest.rs");
    const landed = await call("task_land", { sessionId: data, milestone: "B2", task: "4 manifest", commit: sha });

    expect(waited.structured).toMatchObject({ message: "B2 'T9 store': waits on B2:4 manifest for the manifest's format" });
    expect(waiting.notes).toContain("T9 store: waits for B2:4 manifest (the manifest's format)");
    expect(waiting.tasks.find((t) => t.id === "T9 store")).toMatchObject({ waitsOn: [{ task: "B2:4 manifest", what: "the manifest's format" }] });
    expect(landed.structured).toMatchObject({ message: `B2 '4 manifest': landed at ${sha}; no longer waiting on it: B2 'T9 store'` });
    expect(await taskOf(call, "B2", "T9 store")).toEqual({ id: "T9 store", track: "engine", status: "planned", also: [] });
    expect((await rowOf(call, "B2")).notes).toContain("engine next: T9 store");
  });

  test("task_wait accepts a task that is not planned yet, and task_unwait clears that wait too", async () => {
    const { call, engine } = await tracked();

    const waited = await call("task_wait", { sessionId: engine, milestone: "B2", task: "T9 store", what: "the grid", on: "B7:grid" });
    const malformed = await call("task_wait", { sessionId: engine, milestone: "B2", task: "T9 store", what: "the grid", on: "grid" });
    const cleared = await call("task_unwait", { sessionId: engine, milestone: "B2", task: "T9 store" });

    expect(waited.isError).toBe(false);
    expect(malformed.text).toBe("on takes MILESTONE:TASK, not 'grid'");
    expect(cleared.structured).toMatchObject({ message: "B2 'T9 store': no longer waits for B2, B7:grid (the grid)" });
    expect(await taskOf(call, "B2", "T9 store")).toEqual({ id: "T9 store", track: "engine", status: "planned", also: [] });
  });
});

describe("task_land with deferred parts", () => {
  test("keeps them on the landed task, and the board shows it landed in part until the named task lands", async () => {
    const { call, root, data } = await tracked();
    const first = await commitOnMain(root, "manifest.rs");

    const landed = await call("task_land", { sessionId: data, milestone: "B2", task: "4 manifest", commit: first, deferred: [{ what: "the checksum", to: "B2:5 transcoder" }] });
    const partly = await rowOf(call, "B2");
    const second = await commitOnMain(root, "transcoder.rs");
    await call("task_land", { sessionId: data, milestone: "B2", task: "5 transcoder", commit: second });

    expect(landed.structured).toMatchObject({ message: `B2 '4 manifest': landed at ${first}, in part: 1 deferred` });
    expect(partly.tasks.find((t) => t.id === "4 manifest")).toMatchObject({ status: "landed", deferred: [{ what: "the checksum", to: "B2:5 transcoder" }] });
    expect(partly.notes).toContain("4 manifest landed in part: the checksum");
    expect((await rowOf(call, "B2")).notes).toEqual(["T9 store: waits for B2"]);
  });

  test("refuses a part left to something that is not MILESTONE:TASK, and records nothing", async () => {
    const { call, root, data } = await tracked();
    const sha = await commitOnMain(root, "manifest.rs");

    const refused = await call("task_land", { sessionId: data, milestone: "B2", task: "4 manifest", commit: sha, deferred: [{ what: "the checksum", to: "later" }] });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("a deferred part's to takes MILESTONE:TASK, not 'later'");
    expect(await taskOf(call, "B2", "4 manifest")).toMatchObject({ status: "planned" });
  });
});
