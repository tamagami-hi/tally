import { stat } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { joinQueue, ticketView } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import { endSession } from "../../src/state/end.ts";
import { openSession } from "../../src/state/sessions.ts";
import { openRepo } from "../../src/store/records.ts";
import { closeTrack } from "../../src/tracks/close.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { edit } from "../support/landing.ts";
import { landing, ready, runHead } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

describe("a child track", () => {
  test("lands on main through the queue like any track, and is closed once its work is there", async () => {
    const q = await ready();
    const opened = await openTrack(q.repo, q.session, { name: "helper", purpose: "split the reader" });
    const repo = await openRepo(q.root);
    const tree = opened.track.worktree;
    const helper = await openSession(repo, { worktree: tree, agent: "sonnet" });
    await edit(tree, "src/h.rs");

    const ticket = await joinQueue(repo, helper, landing(["src/h.rs"]));
    await advance(repo);
    expect(await runHead(repo)).toBe(0);
    await advance(repo);

    expect((await ticketView(repo, ticket.id)).state).toBe("landed");
    expect(await sh(q.root, ["log", "-1", "--format=%s", "main"])).toBe("feat(data): the task");
    await endSession(repo, helper.id);
    await closeTrack(repo, q.session, "helper");
    expect(await stat(tree).then(() => true, () => false)).toBe(false);
    expect(await sh(q.root, ["worktree", "list", "--porcelain"])).not.toContain("helper");
    expect(await sh(q.root, ["show", "--stat", "--format=", "main"])).toContain("src/h.rs");
  });

  test("cannot be closed while its landing waits in the queue", async () => {
    const q = await ready();
    const opened = await openTrack(q.repo, q.session, { name: "helper", purpose: "split the reader" });
    const repo = await openRepo(q.root);
    const helper = await openSession(repo, { worktree: opened.track.worktree, agent: "sonnet" });
    await edit(opened.track.worktree, "src/h.rs");
    await joinQueue(repo, helper, landing(["src/h.rs"]));
    await advance(repo);
    await endSession(repo, helper.id);

    await expect(closeTrack(repo, q.session, "helper")).rejects.toThrow("track helper has a landing in the queue");
  });
});
