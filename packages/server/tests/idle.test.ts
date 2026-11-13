import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import { Records, openTrack, readNotes } from "@tally/core";
import { Watcher } from "../src/watcher.ts";
import { opening } from "../../core/tests/support/opening.ts";

const PATIENCE_MS = 15_000;
const TEST_LIMIT_MS = 20_000;
const STEP_MS = 40;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

describe("the watcher and landed worktrees", () => {
  test("closes a landed track that sat idle on its next tick, tells its parent, and goes on", async () => {
    const made = await opening();
    const opened = await openTrack(made.repo, made.data, { name: "helper", purpose: "split the reader" }, new Date(Date.now() - THREE_HOURS_MS));
    await new Records(made.repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => ({ ...milestone, tasks: [...milestone.tasks, { id: "h1", track: "helper", status: "landed" as const, commit: "abc1234", also: [] }] })) }, message: "planned" }));
    const watcher = new Watcher(await made.fresh(), { intervalMs: STEP_MS });
    watcher.start();

    const { isThere } = await import("../../core/tests/support/helped.ts");
    const until = Date.now() + PATIENCE_MS;
    while ((await isThere(opened.track.worktree)) && Date.now() < until) await delay(STEP_MS);
    await watcher.stop();

    expect(await isThere(opened.track.worktree)).toBe(false);
    expect((await readNotes(made.repo)).notes.map((note) => note.text)).toEqual([expect.stringContaining("track helper was closed: its work is on main and it sat idle for ")]);
    expect(watcher.lastFailure).toBeUndefined();
  }, TEST_LIMIT_MS);

  test("keeps going past a track that cannot close, and says so in lastFailure", async () => {
    const made = await opening();
    const opened = await openTrack(made.repo, made.data, { name: "helper", purpose: "split the reader" }, new Date(Date.now() - THREE_HOURS_MS));
    await new Records(made.repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => ({ ...milestone, tasks: [...milestone.tasks, { id: "h1", track: "helper", status: "landed" as const, commit: "abc1234", also: [] }] })) }, message: "planned" }));
    const { sh } = await import("../../core/tests/support/repo.ts");
    await sh(made.root, ["worktree", "remove", opened.track.worktree]);
    await sh(made.root, ["branch", "-D", "track/helper"]);
    const watcher = new Watcher(await made.fresh(), { intervalMs: STEP_MS });
    watcher.start();

    const until = Date.now() + PATIENCE_MS;
    while (watcher.lastFailure === undefined && Date.now() < until) await delay(STEP_MS);
    await watcher.stop();

    expect(watcher.lastFailure).toContain("helper");
  }, TEST_LIMIT_MS);
});
