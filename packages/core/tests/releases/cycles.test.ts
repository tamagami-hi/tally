import { describe, expect, test } from "vitest";
import { cycleList } from "../../src/cycles/list.ts";
import { cycleReleases } from "../../src/releases/cycles.ts";
import { markRelease } from "../../src/releases/mark.ts";
import { Records } from "../../src/store/records.ts";
import { AT, releasing } from "../support/releasing.ts";

describe("a cycle's releases", () => {
  test("are those whose commit lies in its range: after its first commit and at or before its last", async () => {
    const made = await releasing();
    const baseline = (await new Records(made.repo).readLedger()).baseline;
    const one = await made.onMain("src/one.rs", "feat: one");
    await markRelease(made.repo, made.operator, { version: "1.0.0" }, AT);
    const two = await made.onMain("src/two.rs", "feat: two");
    await markRelease(made.repo, made.operator, { version: "1.1.0" }, AT);
    const list = await cycleList(made.repo, {});
    const closed = { n: 1, closedAt: AT.toISOString(), closedBy: { track: "main", agent: "operator" }, summary: "the first", from: baseline, to: one, milestones: 1, tasks: 1 };

    const answered = await cycleReleases(made.repo, { ...list, closed: [closed] }, baseline);

    expect(answered.closed[0]?.releases).toEqual([{ version: "1.0.0", commit: one }]);
    expect(answered.current.releases).toEqual([{ version: "1.0.0", commit: one }, { version: "1.1.0", commit: two }]);
  });

  test("are left out where a cycle has none", async () => {
    const made = await releasing();
    const baseline = (await new Records(made.repo).readLedger()).baseline;

    const answered = await cycleReleases(made.repo, await cycleList(made.repo, {}), baseline);

    expect(answered.current).not.toHaveProperty("releases");
  });
});
