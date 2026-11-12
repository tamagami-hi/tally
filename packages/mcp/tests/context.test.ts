import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened, type Call } from "./support/connect.ts";

interface Serving {
  call: Call;
  root: string;
  data: string;
  operator: string;
}

async function serving(): Promise<Serving> {
  const { repo, root, trees } = await makeTracked();
  const { call } = await connect(repo);
  return { call, root, data: await opened(call, trees["data"]!, "claude"), operator: await opened(call, root, "operator") };
}

const idsOf = (answer: { structured: Record<string, unknown> }): string[] => (answer.structured["entries"] as { id: string }[]).map((entry) => entry.id);

describe("the context tools", () => {
  test("task_claim answers with the entries about the task's own paths, and with none when the task names no path", async () => {
    const { call, data } = await serving();
    await call("context_put", { sessionId: data, kind: "area", title: "the index", text: "built on open", paths: ["src/index"] });
    await call("context_put", { sessionId: data, kind: "finding", title: "the web build is slow", text: "a minute", paths: ["web"] });
    await call("context_put", { sessionId: data, kind: "convention", title: "errors name the file", text: "always" });
    await call("task_plan", { sessionId: data, milestone: "B2", tasks: [{ id: "7 index", paths: ["src/index/build.rs"] }, "8 plain"] });

    const told = await call("task_claim", { sessionId: data, milestone: "B2", task: "7 index" });
    await call("task_release", { sessionId: data, milestone: "B2", task: "7 index" });
    const plain = await call("task_claim", { sessionId: data, milestone: "B2", task: "8 plain" });

    expect(told.structured["entries"]).toEqual([{ id: "area-1", kind: "area", title: "the index" }]);
    expect(plain.isError).toBe(false);
    expect(plain.structured["entries"]).toBeUndefined();
  });

  test("context_put writes an entry as the session, and context_get answers it to anyone", async () => {
    const { call, data } = await serving();

    const put = await call("context_put", { sessionId: data, kind: "finding", title: "the lock is a folder", text: "it holds no file", paths: ["src/store"], tags: ["store"], refs: ["B2"] });
    const got = await call("context_get");

    expect(put.isError).toBe(false);
    expect(put.structured["entry"]).toMatchObject({ id: "finding-1", kind: "finding", paths: ["src/store"], tags: ["store"], refs: ["B2"], by: { track: "data", agent: "claude" } });
    expect(got.structured).toEqual({ entries: [put.structured["entry"]], matched: 1 });
  });

  test("context_get narrows as asked, keeps only the fields asked for, and says how many matched before the limit", async () => {
    const { call, data } = await serving();
    await call("context_put", { sessionId: data, kind: "area", title: "the store", text: "where records are kept", paths: ["src/store"] });
    await call("context_put", { sessionId: data, kind: "howto", title: "run the tests", text: "npm test", paths: ["tests"], tags: ["tests"] });
    await call("context_put", { sessionId: data, kind: "finding", title: "the web build is slow", text: "a minute", paths: ["web"] });

    expect(idsOf(await call("context_get", { paths: ["src/store/lock.ts"] }))).toEqual(["area-1"]);
    expect(idsOf(await call("context_get", { kind: "howto" }))).toEqual(["howto-1"]);
    expect(idsOf(await call("context_get", { tags: ["tests"] }))).toEqual(["howto-1"]);
    expect(idsOf(await call("context_get", { query: "SLOW", sessionId: data }))).toEqual(["finding-1"]);
    expect(idsOf(await call("context_get", { ids: ["area-1", "howto-1"] })).sort()).toEqual(["area-1", "howto-1"]);
    expect((await call("context_get", { limit: 1, fields: ["id", "title"] })).structured).toEqual({ entries: [{ id: "finding-1", title: "the web build is slow" }], matched: 3 });
    expect((await call("context_get", { fields: ["id", "body"] })).text).toBe("an entry has no field 'body'; its fields: id, kind, title, text, paths, tags, refs, by, at, replaces, retiredAt, retiredWhy");
  });

  test("an entry is replaced or retired, never edited, and since tells a reader of both", async () => {
    const { call, data } = await serving();
    await call("context_put", { sessionId: data, kind: "finding", title: "keyed by name", text: "the store keys columns by name" });
    await call("context_put", { sessionId: data, kind: "finding", title: "the web build is slow", text: "a minute" });
    const before = new Date().toISOString();
    await new Promise((done) => setTimeout(done, 5));

    const replaced = await call("context_put", { sessionId: data, kind: "finding", title: "keyed by id", text: "the store keys columns by id", replaces: "finding-1" });
    const retired = await call("context_retire", { sessionId: data, id: "finding-2", why: "it was sped up" });

    expect(replaced.structured["retired"]).toMatchObject({ id: "finding-1", retiredWhy: "replaced by finding-3" });
    expect(retired.structured["entry"]).toMatchObject({ id: "finding-2", retiredWhy: "it was sped up" });
    expect(idsOf(await call("context_get"))).toEqual(["finding-3"]);
    expect(idsOf(await call("context_get", { since: before })).sort()).toEqual(["finding-1", "finding-2", "finding-3"]);
    expect((await call("context_retire", { sessionId: data, id: "finding-2", why: "again" })).text).toMatch(/^finding-2 was retired at /);
  });

  test("a rule and the project record are refused to a track's session and written by the operator's", async () => {
    const { call, data, operator, root } = await serving();
    const rule = { kind: "rule", title: "never push main", text: "pushing is the operator's" };

    const refusedRule = await call("context_put", { sessionId: data, ...rule });
    const refusedProject = await call("project_set", { sessionId: data, purpose: "x" });
    const written = await call("context_put", { sessionId: operator, ...rule });
    await call("project_set", { sessionId: operator, purpose: "replay market data", stack: ["rust"] });
    const project = await call("project_set", { sessionId: operator, layout: [{ path: "crates/core", what: "the library" }], glossary: [{ term: "bar", means: "one interval's prices" }] });

    expect(refusedRule).toMatchObject({ isError: true, text: "only an operator session writes a rule; a track that wants one asks a question with question_add" });
    expect(refusedProject).toMatchObject({ isError: true, text: "only an operator session writes the project record; a track that wants a change asks a question with question_add" });
    expect(written.structured["entry"]).toMatchObject({ id: "rule-1", by: { track: "main", agent: "operator" } });
    expect(project.structured["project"]).toMatchObject({ purpose: "replay market data", stack: ["rust"], layout: [{ path: "crates/core", what: "the library" }], glossary: [{ term: "bar", means: "one interval's prices" }], updated: { by: { track: "main", agent: "operator" } } });
    expect(JSON.parse(await readFile(join(root, "docs/records/context/project.json"), "utf8"))).toEqual(project.structured["project"]);
  });

  test("repo_configure merges into the config record at operator scope, and refuses a key the schema does not have", async () => {
    const { call, data, operator, root } = await serving();
    const onDisk = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(root, "docs/records/config.json"), "utf8")) as Record<string, unknown>;

    const refused = await call("repo_configure", { sessionId: data, config: { locks: ["landing"] } });
    const unknown = await call("repo_configure", { sessionId: operator, config: { colour: "green" } });
    const changed = await call("repo_configure", { sessionId: operator, config: { commands: { test: ["npm", "test"] }, context: "records" } });

    expect(refused).toMatchObject({ isError: true, text: "only an operator session changes the config; a track that wants a change asks a question with question_add" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/^the config has no place for 'colour'; nothing was written/);
    expect(changed.structured).toMatchObject({ changed: ["commands", "context"], config: { context: "records", commands: { test: ["npm", "test"], env: {}, unset: [] } } });
    expect(await onDisk()).toEqual(changed.structured["config"]);
  });
});
