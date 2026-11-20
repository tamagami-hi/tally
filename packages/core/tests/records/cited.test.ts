import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { plan } from "../../src/ledger/ops.ts";
import { assertCited, checkedAccept, decisionsToMark, findCited } from "../../src/records/cited.ts";
import { recordDecision } from "../../src/records/decision-record.ts";
import { addDecision } from "../../src/records/decisions.ts";
import { Records } from "../../src/store/records.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT } from "../support/pending.ts";

const CITING = { id: "3 cite", cites: ["DEC-1", "note-2", "review-1"], accept: ["the reader refuses CSV"] };

describe("what a task cites", () => {
  test("is checked against every kind of record, and an id no record has is refused by name", async () => {
    const { repo, operator } = await cycling();
    await recordDecision(repo, operator, { group: "core", text: "JSON only.", said: "JSON only" }, AT);

    await expect(assertCited(repo, ["DEC-1", "note-2", "review-1", "Q-9", "note-99"])).rejects.toThrow("no record has the id Q-9, note-99; a task cites a decision, a context entry, a question, a note or a review by its id");
    await expect(assertCited(repo, ["DEC-1", "note-2", "review-1"])).resolves.toBeUndefined();
  });

  test("counts a record a closed cycle archived, and answers it from that cycle", async () => {
    const { repo, operator } = await cycling();
    await closeCycle(repo, operator, CLOSE_INPUT, AT);

    await expect(assertCited(repo, ["review-1", "note-1"])).resolves.toBeUndefined();
    const { found } = await findCited(repo, ["review-1"]);

    expect(found).toEqual([expect.objectContaining({ id: "review-1", kind: "review", cycle: 1 })]);
  });

  test("keeps accept to 12 lines of at most 300 characters", () => {
    expect(() => checkedAccept(Array.from({ length: 13 }, (_, n) => `line ${n}`))).toThrow("accept holds at most 12 lines; this one has 13");
    expect(() => checkedAccept(["x".repeat(301)])).toThrow("a line of accept holds at most 300 characters; line 1 has 301");
    expect(checkedAccept(["the reader refuses CSV"])).toEqual(["the reader refuses CSV"]);
  });

  test("is kept on the task with its accept lines by the plan", async () => {
    const { repo } = await cycling();

    await new Records(repo).update((ledger) => plan(ledger, { milestone: "A2", track: "eng", tasks: [CITING] }));

    expect((await new Records(repo).readLedger()).milestones.find((one) => one.id === "A2")?.tasks.find((task) => task.id === "3 cite")).toMatchObject({ cites: CITING.cites, accept: CITING.accept });
  });
});

describe("decisions to mark", () => {
  test("names a decision not yet built whose citing tasks have all landed, and only that one", async () => {
    const { repo, landed } = await cycling();
    const add = (id: string, state: "decided, not built" | "built" | "partly built") => addDecision(repo, { id, group: "core", text: id, since: "2026-11-20", status: state, state }, { operator: true });
    await add("DEC-1", "decided, not built");
    await add("DEC-2", "decided, not built");
    await add("DEC-3", "built");
    await add("DEC-4", "partly built");
    await new Records(repo).update((ledger) => ({
      ledger: {
        ...ledger,
        milestones: ledger.milestones.map((one) => (one.id === "A1" ? { ...one, tasks: one.tasks.map((task) => ({ ...task, cites: ["DEC-1", "DEC-3"] })) } : { ...one, tasks: [...one.tasks.map((task) => ({ ...task, cites: ["DEC-2"] }))] })),
      },
      message: "cited",
    }));

    const marked = await decisionsToMark(repo);

    expect(marked).toEqual([{ id: "DEC-1", group: "core", state: "decided, not built", tasks: ["A1:1 read"] }]);
    expect(landed).toHaveLength(7);
  });
});
