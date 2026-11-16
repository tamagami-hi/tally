import { describe, expect, test } from "vitest";
import { Records } from "../../core/src/store/records.ts";
import type { Milestone } from "../../core/src/schema/ledger.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

interface Row {
  id: string;
  finished: boolean;
  tasks: { id: string; track: string }[];
}

const BRIEF = "Read the cart's rows, check each price against the list, write what changed to the shop's log and keep the old rows beside the new ones until the next sweep has run cleanly. Then say in the hand-off which rows moved, which prices were wrong and why, and what the next sweep should look at first.";
const LANDED_EACH = 4;
const WHOLE_BOARD_MS = 20_000;

const tasksOf = (milestone: string, count: number, commit?: string) => Array.from({ length: count }, (_, n) => ({
  id: `${milestone} step ${n + 1}`, track: n % 2 === 0 ? "data" : "engine", also: [], brief: BRIEF, paths: [`src/${milestone.toLowerCase()}/part-${n + 1}.rs`],
  ...(commit === undefined ? { status: "planned" as const } : { status: "landed" as const, commit }),
}));

async function shop(finished: number, open: number) {
  const tracked = await makeTracked();
  const head = await sh(tracked.root, ["rev-parse", "--short=7", "HEAD"]);
  const built = Array.from({ length: finished }, (_, n): Milestone => ({ id: `S${n + 1}`, stage: "B", name: `shop part ${n + 1}`, track: "data+engine", weight: 1, tasks: tasksOf(`S${n + 1}`, LANDED_EACH, head) }));
  const waiting = Array.from({ length: open }, (_, n): Milestone => ({ id: `W${n + 1}`, stage: "B", name: `next part ${n + 1}`, track: "data+engine", weight: 1, tasks: tasksOf(`W${n + 1}`, 3) }));
  const records = new Records(tracked.repo);
  await records.writeLedger({ ...(await records.readLedger()), milestones: [...built, ...waiting] });
  const { call } = await connect(tracked.repo);
  return { ...tracked, call };
}

const rowsOf = (structured: Record<string, unknown>): Row[] => structured["rows"] as Row[];

describe("board_get with rows open", () => {
  test("keeps only the rows that are not finished, and counts the others in finishedRows", async () => {
    const { call } = await shop(3, 2);

    const board = await call("board_get", { rows: "open" });

    expect(rowsOf(board.structured).map((row) => [row.id, row.finished])).toEqual([["W1", false], ["W2", false]]);
    expect(board.structured["finishedRows"]).toBe(3);
  });

  test("leaves the board as it was by default, with every row and no finishedRows", async () => {
    const { call } = await shop(3, 2);

    const board = await call("board_get");

    expect(rowsOf(board.structured).map((row) => row.id)).toEqual(["S1", "S2", "S3", "W1", "W2"]);
    expect(board.structured).not.toHaveProperty("finishedRows");
    expect((await call("board_get", { rows: "all" })).structured).toStrictEqual(board.structured);
  });

  test("works with scope mine, counting only the track's finished rows", async () => {
    const { call, trees } = await shop(3, 2);
    const session = await opened(call, trees["engine"]!, "claude");

    const board = await call("board_get", { scope: "mine", sessionId: session, rows: "open" });

    expect(rowsOf(board.structured).map((row) => [row.id, row.tasks.every((task) => task.track === "engine")])).toEqual([["W1", true], ["W2", true]]);
    expect(board.structured["finishedRows"]).toBe(3);
  });

  test("works with fields, and keeps finishedRows beside the rows", async () => {
    const { call } = await shop(3, 2);

    const board = await call("board_get", { rows: "open", fields: ["rows"] });

    expect(Object.keys(board.structured).toSorted()).toEqual(["finishedRows", "rows"]);
    expect((await call("board_get", { rows: "open", fields: ["claims"] })).structured).toStrictEqual({ claims: [] });
  });

  test("answers whole for a board of 17 milestones with 7 open, where the whole board is cut", async () => {
    const { call } = await shop(10, 7);

    const whole = await call("board_get");
    const open = await call("board_get", { rows: "open" });

    expect(whole.structured).toHaveProperty("truncated");
    expect(whole.text).toContain("Narrow it with scope, rows or fields.");
    expect(open.structured).not.toHaveProperty("truncated");
    expect(rowsOf(open.structured)).toHaveLength(7);
    expect(open.structured["finishedRows"]).toBe(10);
  }, WHOLE_BOARD_MS);

  test("refuses a rows value it does not know", async () => {
    const { call } = await shop(1, 1);

    expect((await call("board_get", { rows: "done" })).isError).toBe(true);
  });
});
