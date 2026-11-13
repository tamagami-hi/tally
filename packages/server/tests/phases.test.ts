import { describe, expect, test } from "vitest";
import { addPhase } from "@tally/core";
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
});
