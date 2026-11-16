import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { DoneWork } from "@tally/core";
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
});
