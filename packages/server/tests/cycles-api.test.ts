import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Hub } from "../src/hub.ts";
import { createServiceApp } from "../src/service.ts";
import { closeCycle } from "../../core/src/cycles/close.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { closeSession } from "../../core/src/state/sessions.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { AT, cycling } from "../../core/tests/support/cycling.ts";

const hubs: Hub[] = [];

afterEach(async () => {
  while (hubs.length > 0) await hubs.pop()?.stop();
});

async function served() {
  const made = await cycling();
  await closeCycle(made.repo, made.operator, { summary: "the reader is built", said: "close it", name: "the reader" }, AT);
  await closeSession(made.repo, made.operator.id);
  const home = await tmpDir("tally-home-");
  await addRepo(home, { root: made.root, name: "alpha" });
  const web = await tmpDir("tally-web-");
  await mkdir(web, { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>tally</title>");
  const hub = new Hub(new Repos(home), { intervalMs: 50 });
  hubs.push(hub);
  return createServiceApp({ hub, webDir: web, workspace: made.root });
}

describe("the cycles over HTTP", () => {
  test("/cycles answers what cycle_list answers", async () => {
    const app = await served();

    const answer = (await (await app.request("/api/r/alpha/cycles")).json()) as { current: { n: number }; closed: { n: number; name: string }[] };

    expect(answer.current.n).toBe(2);
    expect(answer.closed).toEqual([expect.objectContaining({ n: 1, name: "the reader", summary: "the reader is built" })]);
  });

  test("/cycles/<n>/done answers the finished work of a closed cycle, and refuses the current one", async () => {
    const app = await served();

    const done = (await (await app.request("/api/r/alpha/cycles/1/done")).json()) as { counts: { milestonesFinished: number; tasksLanded: number } };
    const refused = await app.request("/api/r/alpha/cycles/2/done");

    expect(done.counts).toMatchObject({ milestonesFinished: 1, tasksLanded: 1 });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "cycle 2 is the current cycle: leave `cycle` out to read the current cycle" });
  });

  test("/cycles/<n>/done refuses a number too large to be a cycle's, quoting what was sent", async () => {
    const app = await served();

    const refused = await app.request("/api/r/alpha/cycles/99999999999999999999/done");

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "a cycle is named by its number, not '99999999999999999999'" });
  });
});
