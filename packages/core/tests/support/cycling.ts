import { join } from "node:path";
import { addPhase } from "../../src/phases/add.ts";
import { logActivity } from "../../src/records/activity.ts";
import { appendBuildlog } from "../../src/records/buildlog.ts";
import { recordEvidence } from "../../src/records/evidence.ts";
import { writeHandoff } from "../../src/records/handoffs.ts";
import { doneNote, postNote } from "../../src/records/notes.ts";
import { recordReview } from "../../src/records/reviews.ts";
import { closeSession, openSession, type Session } from "../../src/state/sessions.ts";
import { Records, reopenRepo, type Repo } from "../../src/store/records.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { sh } from "./repo.ts";
import { makeTracked } from "./tracked.ts";
import { writeFile } from "node:fs/promises";

export const AT = new Date("2026-11-20T10:00:00.000Z");

export interface Cycling {
  repo: Repo;
  root: string;
  operator: Session;
  landed: string;
  fresh: () => Promise<Repo>;
}

async function landOnMain(root: string): Promise<string> {
  await writeFile(join(root, "a.txt"), "a\n");
  await sh(root, ["add", "a.txt"]);
  await sh(root, ["commit", "-q", "-m", "feat: a"]);
  return sh(root, ["rev-parse", "--short=7", "HEAD"]);
}

async function planned(repo: Repo, landed: string): Promise<void> {
  await new Records(repo).update((ledger) => ({
    ledger: {
      ...ledger,
      milestones: [
        { id: "A1", stage: "B", name: "reader", track: "data", weight: 1, tasks: [{ id: "1 read", track: "data", status: "landed", commit: landed, also: [], deferred: [{ what: "the XML", parked: { why: "no client reads it" } }] }] },
        { id: "A2", stage: "C", name: "writer", track: "eng", weight: 1, tasks: [{ id: "2 write", track: "eng", status: "planned", also: [] }] },
      ],
    },
    message: "planned",
  }));
}

async function records(repo: Repo, root: string, data: Session, landed: string): Promise<void> {
  const ledger = await new Records(repo).readLedger();
  const run = { task: "1 read", kind: "green" as const, command: ["true"], cwd: root, started: "2026-11-20T09:00:00.000Z", seconds: 1, exit: 0 };
  await recordEvidence(repo, data, ledger, { ...run, milestone: "A1" });
  await recordReview(repo, data, { milestone: "A1", task: "1 read", commit: landed, reviewer: "a reader", verdict: "land", blocking: 0, summary: "fine" }, AT);
  await appendBuildlog(repo, { group: "core", milestone: "A1", title: "the reader", date: "2026-11-20", markdown: "Built." });
  await appendBuildlog(repo, { group: "core", milestone: "A2", title: "the writer", date: "2026-11-20", markdown: "Planned." });
  await logActivity(repo, { session: data.id, track: "data", agent: "claude", verb: "task_claim" }, AT);
}

async function notes(repo: Repo, operator: Session): Promise<void> {
  const done = await postNote(repo, operator, { to: "all", kind: "heads-up", text: "the reader is in" }, AT);
  await doneNote(repo, operator, done.id, AT);
  await postNote(repo, operator, { to: "all", kind: "heads-up", text: "the writer is next" }, AT);
  await postNote(repo, operator, { to: ["docs"], kind: "request", text: "write the reader's page" }, AT);
}

export async function cycling(records_: { commit?: boolean } = { commit: true }): Promise<Cycling> {
  const { repo: first, root, trees } = await makeTracked(records_);
  const operator = await openSession(first, { worktree: root, agent: "operator" });
  await addPhase(first, operator, { id: "C", name: "write", goal: "the writer", weight: 1 }, AT);
  await openTrack(await reopenRepo(first), operator, { name: "docs", purpose: "the docs" }, AT);
  await openTrack(await reopenRepo(first), operator, { name: "eng", purpose: "the writer" }, AT);
  const repo = await reopenRepo(first);
  const landed = await landOnMain(root);
  await planned(repo, landed);
  const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
  await records(repo, root, data, landed);
  await notes(repo, operator);
  const docs = await openSession(repo, { worktree: join(root, ".temp/worktrees/docs"), agent: "kiro" });
  await writeHandoff(repo, docs, { lines: ["the page is half done"] }, AT);
  await writeHandoff(repo, data, { lines: ["the reader is done"] }, AT);
  await closeSession(repo, docs.id);
  await closeSession(repo, data.id);
  return { repo, root, operator, landed, fresh: () => reopenRepo(repo) };
}
