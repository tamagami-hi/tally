import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { claimTask } from "../../src/state/claims.ts";
import { listSessions, openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { closeTrack } from "../../src/tracks/close.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { opening } from "../support/opening.ts";

const NOW = new Date("2026-11-20T10:00:00.000Z");

async function withDocs() {
  const opened = await opening();
  await openTrack(opened.repo, opened.operator, { name: "docs", purpose: "the docs" }, NOW);
  const repo = await opened.fresh();
  await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((one) => ({ ...one, tasks: [...one.tasks, { id: "9 docs", track: "docs", status: "planned" as const, also: [] }] })) }, message: "planned" }));
  const tree = join(opened.root, ".temp/worktrees/docs");
  return { ...opened, repo, tree };
}

const onDocs = async (repo: Awaited<ReturnType<typeof withDocs>>["repo"]) => (await listSessions(repo)).filter((session) => session.track === "docs");

describe("closing a track with endSessions", () => {
  test("ends the sessions open on it that hold no claim, then closes it", async () => {
    const { repo, operator, tree } = await withDocs();
    await openSession(repo, { worktree: tree, agent: "claude" });
    await openSession(repo, { worktree: tree, agent: "kiro" });

    const closed = await closeTrack(repo, operator, "docs", NOW, { endSessions: true });

    expect(closed.track.closedAt).toBe(NOW.toISOString());
    expect(closed.ended?.map((session) => session.agent).sort()).toEqual(["claude", "kiro"]);
    expect(await onDocs(repo)).toEqual([]);
  });

  test("refuses, ending nothing, while a session on it holds a claim", async () => {
    const { repo, operator, tree } = await withDocs();
    const holder = await openSession(repo, { worktree: tree, agent: "claude" });
    await openSession(repo, { worktree: tree, agent: "kiro" });
    await claimTask(repo, holder, await new Records(repo).readLedger(), "B2", "9 docs");

    await expect(closeTrack(repo, operator, "docs", NOW, { endSessions: true })).rejects.toThrow(`track docs has a session that holds a claim ('9 docs' in B2, held by claude, session ${holder.id}); it releases the task or closes first`);
    expect(await onDocs(repo)).toHaveLength(2);
  });

  test("refuses a session that may not close the track before ending anything", async () => {
    const { repo, data, tree } = await withDocs();
    await openSession(repo, { worktree: tree, agent: "claude" });

    await expect(closeTrack(repo, data, "docs", NOW, { endSessions: true })).rejects.toThrow("only an operator session or a session of its parent track (it has none) closes track docs");
    expect(await onDocs(repo)).toHaveLength(1);
  });

  test("without it, names endSessions in the refusal for an open session", async () => {
    const { repo, operator, tree } = await withDocs();
    await openSession(repo, { worktree: tree, agent: "claude" });

    await expect(closeTrack(repo, operator, "docs", NOW)).rejects.toThrow(/close it first, or pass endSessions: true to end the sessions that hold no claim/);
  });
});
