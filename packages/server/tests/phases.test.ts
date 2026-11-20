import { describe, expect, test } from "vitest";
import { addPhase, recordManual } from "@tally/core";
import { fingerprint } from "../src/watcher.ts";
import { opening } from "../../core/tests/support/opening.ts";

describe("the watcher's view of the records", () => {
  test("changes when a phase is added to a records folder that already differs from HEAD, so the board is told", async () => {
    const { repo, operator } = await opening();
    await addPhase(repo, operator, { id: "G", name: "exports", goal: "Ship exports.", weight: 3 });
    const before = await fingerprint(repo);

    await addPhase(repo, operator, { id: "H", name: "imports", goal: "Take imports in.", weight: 2 });

    expect(await fingerprint(repo)).not.toBe(before);
  });

  test("changes when a second check made by hand is written to a milestone's file, so the Evidence page is told", async () => {
    const { repo, data } = await opening();
    const check = { milestone: "B2", task: "4 manifest", who: "the operator", result: "pass" as const, steps: ["open it"] };
    await recordManual(repo, data, check);
    const before = await fingerprint(repo);

    await recordManual(repo, data, { ...check, result: "fail" });

    expect(await fingerprint(repo)).not.toBe(before);
  });
});
