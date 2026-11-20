import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { unwait, wait } from "../../src/ledger/ops.ts";
import { addPhase } from "../../src/phases/add.ts";
import { addDecision, decisionsPath, setDecisionStatus } from "../../src/records/decisions.ts";
import { addQuestion, answerQuestion, questionsPath } from "../../src/records/questions.ts";
import { recordReview, reviewsPath } from "../../src/records/reviews.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { tracksPath } from "../../src/tracks/file.ts";
import { phasesPath } from "../../src/phases/file.ts";
import { Records, reopenRepo } from "../../src/store/records.ts";
import { OPERATOR } from "../support/context.ts";
import { reviewing } from "../support/reviews.ts";
import { makeTracked } from "../support/tracked.ts";
import { openSession } from "../../src/state/sessions.ts";

type Raw = Record<string, unknown>;
type Items = Raw[];

const FUTURE = { kept: "by a later build" };

async function readRaw(path: string): Promise<Raw> {
  return JSON.parse(await readFile(path, "utf8")) as Raw;
}

async function addExtras(path: string, change: (raw: Raw) => Raw): Promise<void> {
  await writeFile(path, `${JSON.stringify(change(await readRaw(path)), null, 2)}\n`);
}

const itemsOf = (raw: Raw, key: string): Items => raw[key] as Items;

describe("a build keeps the keys it does not know", () => {
  it("keeps them on the ledger, a milestone, a task and an other commit", async () => {
    const { repo } = await makeTracked();
    const records = new Records(repo);
    await records.update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "def5678", note: "chore" }] }, message: "other" }));
    await addExtras(records.ledgerPath, (raw) => {
      const milestones = itemsOf(raw, "milestones").map((one) => ({ ...one, future: FUTURE, tasks: (one["tasks"] as Items).map((task) => ({ ...task, future: FUTURE })) }));
      return { ...raw, future: FUTURE, milestones, other: itemsOf(raw, "other").map((one) => ({ ...one, future: FUTURE })) };
    });

    await records.update((ledger) => wait(ledger, { milestone: "B2", task: "4 manifest", what: "the schema" }));
    await records.update((ledger) => unwait(ledger, { milestone: "B2", task: "4 manifest" }));

    const raw = await readRaw(records.ledgerPath);
    const milestone = itemsOf(raw, "milestones")[0]!;
    expect(raw["future"]).toEqual(FUTURE);
    expect(milestone["future"]).toEqual(FUTURE);
    expect((milestone["tasks"] as Items).every((task) => (task["future"] as unknown) !== undefined)).toBe(true);
    expect(itemsOf(raw, "other")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on the tracks file and an opened track", async () => {
    const { repo, root } = await makeTracked();
    const operator = await openSession(repo, { worktree: root, agent: "operator" });
    await openTrack(repo, operator, { name: "docs", purpose: "the docs" });
    await addExtras(tracksPath(repo.recordsDir), (raw) => ({ ...raw, future: FUTURE, tracks: itemsOf(raw, "tracks").map((one) => ({ ...one, future: FUTURE })) }));

    await openTrack(await reopenRepo(repo), operator, { name: "site", purpose: "the site" });

    const raw = await readRaw(tracksPath(repo.recordsDir));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "tracks").find((one) => one["name"] === "docs")!["future"]).toEqual(FUTURE);
  });

  it("keeps them on the phases file and a phase", async () => {
    const { repo } = await makeTracked();
    await addPhase(repo, OPERATOR, { id: "P1", name: "first", goal: "the first part", weight: 1 });
    await addExtras(phasesPath(repo.recordsDir), (raw) => ({ ...raw, future: FUTURE, phases: itemsOf(raw, "phases").map((one) => ({ ...one, future: FUTURE })) }));

    await addPhase(await reopenRepo(repo), OPERATOR, { id: "P2", name: "second", goal: "the second part", weight: 1 });

    const raw = await readRaw(phasesPath(repo.recordsDir));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "phases")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on the decisions file, a decision and a replaced row", async () => {
    const { repo } = await makeTracked();
    await addDecision(repo, { id: "DEC-1", group: "platform", text: "Keep it small.", since: "2026-11-01", status: "decided, not built" }, { operator: true });
    await addExtras(decisionsPath(repo), (raw) => ({
      ...raw,
      future: FUTURE,
      decisions: itemsOf(raw, "decisions").map((one) => ({ ...one, future: FUTURE })),
      replaced: [{ id: "DEC-0", group: "platform", was: "old", replaced: "2026-11-01, by DEC-0", why: "moved", future: FUTURE }],
    }));

    await setDecisionStatus(repo, { id: "DEC-1", group: "platform", status: "built" }, { by: "operator" });

    const raw = await readRaw(decisionsPath(repo));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "decisions")[0]!["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "replaced")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on the questions file and a question that is answered", async () => {
    const { repo } = await makeTracked();
    await addQuestion(repo, { group: "platform", question: "Which store?", meanwhile: "the file store" });
    await addExtras(questionsPath(repo), (raw) => ({ ...raw, future: FUTURE, open: itemsOf(raw, "open").map((one) => ({ ...one, future: FUTURE })) }));

    await answerQuestion(repo, 1, "DEC-1");

    const raw = await readRaw(questionsPath(repo));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "answered")[0]!["future"]).toEqual(FUTURE);
  });

  it("keeps them on the reviews file and a review", async () => {
    const { repo, data, head } = await reviewing(false);
    const review = { milestone: "B2", task: "done", commit: head, reviewer: "a reader", verdict: "fix" as const, blocking: 1, summary: "one thing" };
    await recordReview(repo, data, review);
    await addExtras(reviewsPath(repo), (raw) => ({ ...raw, future: FUTURE, reviews: itemsOf(raw, "reviews").map((one) => ({ ...one, future: FUTURE })) }));

    await recordReview(repo, data, { ...review, verdict: "land", blocking: 0, summary: "fixed", follows: "review-1" });

    const raw = await readRaw(reviewsPath(repo));
    expect(raw["future"]).toEqual(FUTURE);
    expect(itemsOf(raw, "reviews")[0]!["future"]).toEqual(FUTURE);
  });
});
