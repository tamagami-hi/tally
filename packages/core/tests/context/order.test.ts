import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { sessionBrief } from "../../src/context/brief.ts";
import { putEntry } from "../../src/context/entries.ts";
import type { OrderBrief, OrderCited } from "../../src/context/order.ts";
import { closeCycle } from "../../src/cycles/close.ts";
import { plan } from "../../src/ledger/ops.ts";
import { recordDecision } from "../../src/records/decision-record.ts";
import { doneNote } from "../../src/records/notes.ts";
import { addQuestion } from "../../src/records/questions.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT } from "../support/pending.ts";

const DECISION = "The writer writes JSON, and only JSON.";
const ACCEPT = ["the writer writes JSON", "a CSV is refused"];

async function citing(repo: Repo, cites: string[], task = "3 order"): Promise<void> {
  await new Records(repo).update((ledger) => plan(ledger, { milestone: "A2", track: "eng", tasks: [{ id: task, cites, accept: ["the order is word for word"] }] }));
}

async function ordered(cites = ["DEC-1", "rule-1", "Q-1", "note-2", "review-1"]) {
  const made = await cycling();
  const { repo, operator } = made;
  await recordDecision(repo, operator, { group: "core", text: DECISION, said: "JSON only", accept: ACCEPT }, AT);
  await recordDecision(repo, operator, { group: "core", text: "A decision no task cites.", said: "later" }, AT);
  await putEntry(repo, operator, { kind: "rule", title: "Write the test first", text: "A test seen failing first.", section: "working", source: "the operator" });
  await putEntry(repo, operator, { kind: "rule", title: "Never push", text: "Pushing is the operator's.", section: "safety", source: "the operator" });
  await putEntry(repo, operator, { kind: "rule", title: "Keep files small", text: "Under 400 lines each.", section: "working", source: "the operator" });
  await addQuestion(repo, { group: "core", question: "JSON or CSV?", meanwhile: "JSON" });
  await citing(repo, cites);
  const eng = await openSession(repo, { worktree: join(made.root, ".temp/worktrees/eng"), agent: "kiro" });
  return { ...made, eng };
}

const orderOf = async (repo: Repo, session: Awaited<ReturnType<typeof ordered>>["eng"], room?: number): Promise<OrderBrief> => (await sessionBrief(repo, session, "order", room === undefined ? {} : { room })) as OrderBrief;
const citedOf = (order: OrderBrief, id: string): OrderCited | undefined => (order.cited ?? []).find((one) => one.id === id);

describe("the work order", () => {
  test("carries a cited decision's text and accept exactly as stored, and the text of no decision that is not cited", async () => {
    const { repo, eng } = await ordered();

    const order = await orderOf(repo, eng);

    expect(order.level).toBe("order");
    expect(citedOf(order, "DEC-1")).toEqual({ id: "DEC-1", of: "decision", group: "core", state: "in force", text: DECISION, accept: ACCEPT });
    expect(JSON.stringify(order)).not.toContain("A decision no task cites.");
  });

  test("gives a cited rule its text, an uncited working rule none, and a safety rule always its text", async () => {
    const { repo, eng } = await ordered();

    const rules = new Map(((await orderOf(repo, eng)).rules ?? []).map((rule) => [rule.id, rule.text]));

    expect(rules.get("rule-1")).toBe("A test seen failing first.");
    expect(rules.get("rule-2")).toBe("Pushing is the operator's.");
    expect(rules.has("rule-3")).toBe(true);
    expect(rules.get("rule-3")).toBeUndefined();
  });

  test("carries the track's task with its accept and cites, a question with its meanwhile, a note's text and a review's summary", async () => {
    const { repo, eng } = await ordered();

    const order = await orderOf(repo, eng);

    expect(order.track.tasks.find((task) => task.id === "3 order")).toMatchObject({ milestone: "A2", accept: ["the order is word for word"], cites: ["DEC-1", "rule-1", "Q-1", "note-2", "review-1"] });
    expect(citedOf(order, "Q-1")).toMatchObject({ of: "question", question: "JSON or CSV?", meanwhile: "JSON" });
    expect(citedOf(order, "note-2")).toMatchObject({ of: "note", text: "the writer is next" });
    expect(citedOf(order, "review-1")).toMatchObject({ of: "review", summary: "fine", verdict: "land" });
    expect(order.cycle).toEqual({ n: 1 });
  });

  test("is answered at work, saying so, to an operator session", async () => {
    const { repo, operator } = await ordered();

    const brief = await sessionBrief(repo, operator, "order");

    expect(brief).toMatchObject({ level: "work", asked: "order" });
  });
});

describe("the work order's cited records, when the records move or grow", () => {
  test("answers a record a cycle's close archived from that cycle, and does not fail", async () => {
    const made = await ordered(["review-1"]);
    await closeCycle(made.repo, made.operator, CLOSE_INPUT, AT);

    const order = await orderOf(made.repo, made.eng);

    expect(citedOf(order, "review-1")).toMatchObject({ of: "review", summary: "fine", cycle: 1 });
  });

  test("answers a record that changed since as it now stands, with what changed", async () => {
    const { repo, operator, eng } = await ordered();
    await recordDecision(repo, operator, { group: "core", id: "DEC-1", text: "JSON and CSV.", said: "add CSV", replaces: { why: "CSV came in" } }, AT);
    await doneNote(repo, operator, "note-2", AT);

    const order = await orderOf(repo, eng);

    expect(citedOf(order, "DEC-1")).toMatchObject({ text: "JSON and CSV.", changed: expect.stringContaining("CSV came in") });
    expect(citedOf(order, "note-2")).toMatchObject({ text: "the writer is next", changed: `done at ${AT.toISOString()}` });
  });

  test("leaves out whole records from the end when they pass the limit, names them, and says how to read them", async () => {
    const made = await ordered([]);
    for (const n of [3, 4, 5]) await recordDecision(made.repo, made.operator, { group: "core", text: `${n}`.repeat(9_000), said: "long" }, AT);
    await citing(made.repo, ["DEC-3", "DEC-4", "DEC-5"], "4 long");

    const order = await orderOf(made.repo, made.eng, 20_000);

    expect((order.cited ?? []).map((one) => [one.id, "text" in one ? one.text.length : 0])).toEqual([["DEC-3", 9_000], ["DEC-4", 9_000]]);
    expect(order.citedLeftOut).toEqual({ ids: ["DEC-5"], read: expect.stringContaining("decision_list") });
  });

  test("says a cited record could not be read rather than fail, when its file does not parse", async () => {
    const { repo, eng } = await ordered(["review-1", "DEC-1"]);
    await writeFile(join(repo.recordsDir, "reviews.json"), "{ not json");

    const order = await orderOf(repo, eng);

    expect(citedOf(order, "review-1")).toMatchObject({ id: "review-1", missing: expect.stringContaining("could not be read") });
    expect(citedOf(order, "DEC-1")).toMatchObject({ text: DECISION });
  });

  test("leaves out whole rules from the end when the rules alone pass the room, names them, and slices none", async () => {
    const made = await ordered(["DEC-1"]);
    for (const n of Array.from({ length: 12 }, (_, index) => index)) await putEntry(made.repo, made.operator, { kind: "rule", title: `Safety ${n}`, text: `${n % 10}`.repeat(590), section: "safety", source: "the operator" });

    const order = await orderOf(made.repo, made.eng, 5_000);
    const texts = (order.rules ?? []).filter((rule) => rule.title.startsWith("Safety")).map((rule) => rule.text?.length);

    expect(order.rulesLeftOut?.ids.length).toBeGreaterThan(0);
    expect(order.rulesLeftOut?.read).toContain("rulebook_get");
    expect(texts.every((length) => length === 590)).toBe(true);
    expect(JSON.stringify(order.rules).length).toBeLessThanOrEqual(5_000);
    expect([...(order.rules ?? []).map((rule) => rule.id), ...(order.rulesLeftOut?.ids ?? [])]).toHaveLength(15);
  });
});
