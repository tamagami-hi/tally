import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { finishPendingClose } from "../../src/cycles/finish.ts";
import { recordManual } from "../../src/records/manual.ts";
import { AT, cycling } from "../support/cycling.ts";
import { bothFolders, isPending, OPERATIONS, pendingClose } from "../support/pending.ts";

const CHECK = { who: "the operator", result: "pass" as const, steps: ["open the app"] };
const STOPS = Array.from({ length: OPERATIONS + 2 }, (_, index) => index);

async function withChecks() {
  const made = await cycling();
  await recordManual(made.repo, made.operator, { ...CHECK, milestone: "A1", task: "1 read" }, AT);
  await recordManual(made.repo, made.operator, { ...CHECK, milestone: "A2", task: "2 write" }, AT);
  return made;
}

describe("manual checks at a cycle's close", () => {
  test.each(STOPS)("an archived milestone's file moves and a carried one's stays, when the close stops after %i steps and is finished", async (steps) => {
    const made = await withChecks();

    await pendingClose(made, steps);
    await finishPendingClose(made.repo);

    expect(await isPending(made.repo)).toBe(false);
    const archived = await bothFolders(made.repo, join("manual", "A1.json"));
    const carried = await bothFolders(made.repo, join("manual", "A2.json"));
    expect([archived.current, archived.cycle?.["milestone"]]).toEqual([undefined, "A1"]);
    expect([carried.current?.["milestone"], carried.cycle]).toEqual(["A2", undefined]);
  });
});
