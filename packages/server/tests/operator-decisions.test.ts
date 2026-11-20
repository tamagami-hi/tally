import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Hub } from "../src/hub.ts";
import { createServiceApp } from "../src/service.ts";
import { CLOSE_BUSY } from "../../core/src/cycles/finish.ts";
import { landingLockPath } from "../../core/src/records/commit.ts";
import { recordDecision } from "../../core/src/records/decision-record.ts";
import { readDecisions } from "../../core/src/records/decisions.ts";
import { stateDirOf } from "../../core/src/repos/home.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { closeSession, openSession } from "../../core/src/state/sessions.ts";
import type { Repo } from "../../core/src/store/records.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { holding, pendingClose } from "../../core/tests/support/pending.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const OPERATOR = { "content-type": "application/json", "x-tally-operator": "1" };
const hubs: Hub[] = [];

afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.stop();
});

async function serving(repo: Repo, root: string) {
  const home = await tmpDir("tally-home-");
  await addRepo(home, { root, name: "alpha" });
  const web = await tmpDir("tally-web-");
  await mkdir(web, { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>tally</title>");
  const hub = new Hub(new Repos(home), { intervalMs: 50 });
  hubs.push(hub);
  const operator = await openSession(repo, { worktree: root, agent: "operator" });
  await recordDecision(repo, operator, { group: "core", text: "JSON only.", said: "JSON only" });
  return { app: createServiceApp({ hub, webDir: web, workspace: root }), home };
}

const post = (app: Awaited<ReturnType<typeof serving>>["app"], path: string, headers: Record<string, string> = OPERATOR, body: unknown = {}) =>
  Promise.resolve(app.request(path, { method: "POST", headers, body: JSON.stringify(body) }));

describe("confirming a decision from the board", () => {
  test("confirm and Not mine set the mark, the later clearing the other", async () => {
    const { repo, root } = await makeTracked();
    const { app } = await serving(repo, root);

    const disputed = await post(app, "/api/r/alpha/operator/decisions/core/DEC-1/dispute");
    const confirmed = await post(app, "/api/r/alpha/operator/decisions/core/DEC-1/confirm");

    expect(disputed.status).toBe(200);
    expect(((await confirmed.json()) as { decision: Record<string, unknown> }).decision).toMatchObject({ id: "DEC-1", confirmed: { at: expect.any(String) } });
    expect((await readDecisions(repo)).decisions[0]?.disputed).toBeUndefined();
  });

  test("are served for the default repository too, as the board at / calls them", async () => {
    const { repo, root } = await makeTracked();
    const { app } = await serving(repo, root);

    const confirmed = await post(app, "/api/operator/decisions/core/DEC-1/confirm");

    expect(confirmed.status).toBe(200);
    expect((await readDecisions(repo)).decisions[0]?.confirmed).toBeDefined();
  });

  test("are the operator's only, and match the group and id against the file, never a path", async () => {
    const { repo, root } = await makeTracked();
    const { app } = await serving(repo, root);

    const unmarked = await post(app, "/api/r/alpha/operator/decisions/core/DEC-1/confirm", { "content-type": "application/json" });
    const unknown = await post(app, "/api/r/alpha/operator/decisions/core/DEC-9/confirm");
    const climbing = await post(app, `/api/r/alpha/operator/decisions/${encodeURIComponent("../../config")}/DEC-1/confirm`);

    expect(unmarked.status).toBe(403);
    expect(await unknown.json()).toEqual({ error: "core has no decision DEC-9; its decisions are DEC-1" });
    expect(await climbing.json()).toEqual({ error: "../../config has no decision DEC-1; its decisions are none" });
    expect((await readDecisions(repo)).decisions[0]?.confirmed).toBeUndefined();
  });
});

describe("the operator's writing routes while a cycle close is pending", () => {
  test("are refused while the close is being finished elsewhere", async () => {
    const made = await cycling({ commit: false });
    await closeSession(made.repo, made.operator.id);
    const { app, home } = await serving(made.repo, made.root);
    await pendingClose(made);
    const held = await holding(landingLockPath({ ...made.repo, stateDir: stateDirOf(home, "alpha") }));

    const answers = [
      await post(app, "/api/r/alpha/operator/decisions/core/DEC-1/confirm"),
      await post(app, "/api/r/alpha/operator/decisions/core/DEC-1/dispute"),
      await post(app, "/api/r/alpha/operator/decisions", OPERATOR, { id: "DEC-5", group: "core", text: "x", since: "2026-11-21", status: "in force" }),
      await post(app, "/api/r/alpha/operator/questions/1/answer", OPERATOR, { decision: "DEC-1" }),
    ];
    await held.release();

    expect(await Promise.all(answers.map(async (one) => [one.status, ((await one.json()) as { error?: string }).error]))).toEqual([[400, CLOSE_BUSY], [400, CLOSE_BUSY], [400, CLOSE_BUSY], [400, CLOSE_BUSY]]);
  });
});
