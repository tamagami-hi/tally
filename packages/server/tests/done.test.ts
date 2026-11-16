import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { logActivity, type DoneWork, type EndedSessions } from "@tally/core";
import { createApp } from "../src/app.ts";
import { Watcher } from "../src/watcher.ts";
import { finishedWork } from "../../core/tests/support/done.ts";

async function served() {
  const made = await finishedWork();
  const web = join(made.root, ".temp", "web");
  await mkdir(web, { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>tally</title>");
  return { ...made, app: createApp({ repo: made.repo, watcher: new Watcher(made.repo), webDir: web }) };
}

describe("the Done routes", () => {
  test("/done answers what is finished, from the status the board shows", async () => {
    const { app } = await served();

    const response = await app.request("/api/done");
    const done = (await response.json()) as DoneWork;

    expect(response.status).toBe(200);
    expect(done.counts).toEqual({ phasesClosed: 2, milestonesFinished: 2, tasksLanded: 5 });
    expect(done.phases.map((phase) => phase.id)).toEqual(["H", "G", "B"]);
  });

  test("/done/sessions answers the ended sessions, as many as the limit asks", async () => {
    const { app, repo } = await served();
    const logging = { ...repo, config: { ...repo.config, context: "records" as const } };
    for (const session of ["s1", "s2", "s3"]) await logActivity(logging, { session, track: "data", agent: "claude", verb: "handoff_write" });

    const two = (await (await app.request("/api/done/sessions?limit=2")).json()) as EndedSessions;
    const whole = (await (await app.request("/api/done/sessions")).json()) as EndedSessions;

    expect(two).toMatchObject({ kept: true, total: 3 });
    expect(two.sessions).toHaveLength(2);
    expect(whole.sessions).toHaveLength(3);
  });

  test.each(["0", "501", "abc", "1.5", "", "1e2"])("/done/sessions refuses the limit '%s' in a sentence", async (limit) => {
    const { app } = await served();

    const response = await app.request(`/api/done/sessions?limit=${limit}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "limit must be a whole number from 1 to 500" });
  });
});
