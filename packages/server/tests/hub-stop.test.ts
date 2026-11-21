import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Hub } from "../src/hub.ts";
import { Watcher } from "../src/watcher.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const AFTER_THE_STOP_MS = 200;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stopping the hub", () => {
  test("leaves no watcher running that a pass over the list, under way at the stop, would have started", async () => {
    const home = await tmpDir("tally-home-");
    await addRepo(home, { root: (await makeTracked()).root, name: "alpha" });
    const repos = new Repos(home);
    const listed = repos.entries.bind(repos);
    let release = (): void => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    vi.spyOn(repos, "entries").mockImplementation(async () => {
      await held;
      return listed();
    });
    const started = new Set<Watcher>();
    const stopped = new Set<Watcher>();
    const start = Watcher.prototype.start;
    const stop = Watcher.prototype.stop;
    vi.spyOn(Watcher.prototype, "start").mockImplementation(function (this: Watcher) {
      started.add(this);
      start.call(this);
    });
    vi.spyOn(Watcher.prototype, "stop").mockImplementation(function (this: Watcher) {
      stopped.add(this);
      return stop.call(this);
    });
    const hub = new Hub(repos, { intervalMs: 50 });

    hub.start();
    const stopping = hub.stop();
    release();
    await stopping;
    await delay(AFTER_THE_STOP_MS);
    const running = [...started].filter((watcher) => !stopped.has(watcher));
    await Promise.all(running.map((watcher) => stop.call(watcher)));

    expect(running).toHaveLength(0);
  });
});
