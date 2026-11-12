import { describe, expect, test } from "vitest";
import { snapshot } from "../src/watcher.ts";
import { joinQueue } from "../../core/src/land/queue.ts";
import { advance } from "../../core/src/land/turn.ts";
import { edit } from "../../core/tests/support/landing.ts";
import { landing, ready } from "../../core/tests/support/queue.ts";

describe("the board's view of the landing queue", () => {
  test("lists the tickets that are waiting or in their turn, in order", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    await edit(q.engine.tree, "src/e.rs");
    await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await joinQueue(q.repo, q.engine.session, landing(["src/e.rs"]));
    await advance(q.repo);

    const { state } = await snapshot(q.repo);

    expect(state.queue.map((ticket) => [ticket.track, ticket.agent, ticket.state])).toEqual([["data", "claude", "turn"], ["engine", "kiro", "queued"]]);
  });

  test("is empty when nothing is landing", async () => {
    const q = await ready();

    expect((await snapshot(q.repo)).state.queue).toEqual([]);
  });
});
