import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fromBoard } from "../../src/ledger/import.ts";
import { ledgerSchema } from "../../src/schema/ledger.ts";

const board = JSON.parse(readFileSync(new URL("../fixtures/board.json", import.meta.url), "utf8")) as unknown;
const names = { A: "the thin slice", B: "widen every part", C: "waits on the operator" };

describe("importing today's board", () => {
  const { ledger, stages } = fromBoard(board, names);

  test("gives a valid ledger with every milestone, task and other commit", () => {
    expect(() => ledgerSchema.parse(ledger)).not.toThrow();
    expect(ledger.baseline).toBe("d0ff4a5");
    expect(ledger.milestones).toHaveLength(14);
    expect(ledger.milestones.reduce((n, m) => n + m.tasks.length, 0)).toBe(52);
    expect(ledger.other).toHaveLength(6);
    expect(ledger.other.find((o) => o.commit === "bf8e993")?.note).toBe("rule: the progress ledger");
  });

  test("keeps each task's commit, also list and wait, and derives its status", () => {
    const b4 = ledger.milestones.find((m) => m.id === "B4")!;
    const fixes = b4.tasks.find((t) => t.id === "data review fixes D1-D3")!;
    expect(fixes).toEqual({ id: "data review fixes D1-D3", track: "data", status: "landed", commit: "a092dda", also: ["7d2cd43", "5de7088", "6a58938"] });
    const t7b2 = b4.tasks.find((t) => t.id === "T7b2 future/equity legs run")!;
    expect(t7b2.status).toBe("planned");
    expect(t7b2.commit).toBeUndefined();
    expect(t7b2.waits).toMatch(/^Remaining mixed/);
    expect(b4.tasks[b4.tasks.length - 1]!.id).toBe("B4 close");
  });

  test("keeps a built milestone's range and a waiting milestone's reason", () => {
    expect(ledger.milestones.find((m) => m.id === "B1")!.built).toBe("6752fe4..dd43951");
    expect(ledger.milestones.find((m) => m.id === "C1")!.waits).toBe("the recorder's candle files");
  });

  test("turns the stage weights into the config's stages with their names", () => {
    expect(stages).toEqual([
      { id: "A", name: "the thin slice", weight: 32 },
      { id: "B", name: "widen every part", weight: 52 },
      { id: "C", name: "waits on the operator", weight: 16 },
    ]);
  });

  test("refuses a board that is not one", () => {
    expect(() => fromBoard({ milestones: "no" }, names)).toThrow(/baseline|milestones/);
  });
});
