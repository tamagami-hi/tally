import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened, type Call } from "./support/connect.ts";

interface Note {
  lines: string[];
}

async function handedOver(times: number): Promise<Call> {
  const { repo, trees } = await makeTracked();
  const { call } = await connect(repo);
  const data = await opened(call, trees["data"]!, "claude");
  for (let n = 1; n <= times; n += 1) await call("handoff_write", { sessionId: data, lines: [`note ${n}`] });
  return call;
}

const linesOf = (notes: unknown): string[] => (notes as Note[]).map((note) => note.lines[0] ?? "");

describe("handoff_read with history", () => {
  test("0 answers the current note alone, and earlier counts the notes left out", async () => {
    const call = await handedOver(4);

    const read = await call("handoff_read", { track: "data", history: 0 });

    expect(read.structured).toMatchObject({ track: "data", current: { lines: ["note 4"] }, history: [], earlier: 3 });
  });

  test("1 answers the latest earlier note", async () => {
    const call = await handedOver(4);

    const read = await call("handoff_read", { track: "data", history: 1 });

    expect(linesOf(read.structured["history"])).toEqual(["note 3"]);
    expect(read.structured["earlier"]).toBe(2);
  });

  test("more than there are answers them all, oldest first, with none left out", async () => {
    const call = await handedOver(4);

    const read = await call("handoff_read", { track: "data", history: 10 });

    expect(linesOf(read.structured["history"])).toEqual(["note 1", "note 2", "note 3"]);
    expect(read.structured["earlier"]).toBe(0);
  });

  test("left out, answers as before, with no earlier", async () => {
    const call = await handedOver(3);

    const read = await call("handoff_read", { track: "data" });

    expect(linesOf(read.structured["history"])).toEqual(["note 1", "note 2"]);
    expect(Object.keys(read.structured).sort()).toEqual(["current", "history", "schema", "track"]);
  });

  test("a track with no hand-off answers no note, and nothing left out", async () => {
    const call = await handedOver(0);

    const read = await call("handoff_read", { track: "engine", history: 0 });

    expect(read.structured).toEqual({ schema: 1, track: "engine", history: [], earlier: 0 });
  });

  test("refuses a count below 0", async () => {
    const call = await handedOver(1);

    expect((await call("handoff_read", { track: "data", history: -1 })).isError).toBe(true);
  });
});
