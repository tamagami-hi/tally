import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { carryOut, finishPendingClose } from "../../src/cycles/close.ts";
import { closingPath } from "../../src/cycles/file.ts";
import { planClose, type ClosePlan } from "../../src/cycles/plan.ts";
import { writeJsonAtomic } from "../../src/store/json.ts";
import { closeOpened } from "../../src/tracks/close.ts";
import { isPresent } from "../../src/tracks/file.ts";
import { AT, cycling } from "../support/cycling.ts";
import { sh } from "../support/repo.ts";

const BY = { track: "main", agent: "operator" };
const INPUT = { summary: "the reader is built", said: "close it" };

async function killedAfter(steps: number) {
  const made = await cycling();
  await closeOpened(made.repo, "docs", { by: BY, now: AT, why: "cycle 1 closed", commit: false });
  const plan = await planClose(made.repo, { by: BY, now: AT, input: INPUT });
  await writeJsonAtomic(closingPath(made.repo.recordsDir, 1), plan);
  await carryOut(made.repo, plan, steps);
  return { ...made, plan };
}

const operationsOf = (plan: ClosePlan): number => plan.writes.length + plan.moves.length + 1;

async function asPlanned(recordsDir: string, plan: ClosePlan): Promise<void> {
  for (const write of [...plan.writes, plan.last]) expect(JSON.parse(await readFile(join(recordsDir, write.path), "utf8"))).toEqual(JSON.parse(JSON.stringify(write.contents)));
  for (const move of plan.moves) {
    expect(await isPresent(join(recordsDir, move.from))).toBe(false);
    expect(await isPresent(join(recordsDir, move.to))).toBe(true);
  }
}

describe("a close killed part way", () => {
  test.each([0, 1, 5, 11, 12, 13, 14, 15, 16])("after %i steps, is finished by the next call as it was planned, and committed once", async (steps) => {
    const { repo, root, plan } = await killedAfter(steps);
    expect(operationsOf(plan)).toBe(16);

    await finishPendingClose(repo);

    await asPlanned(repo.recordsDir, plan);
    expect(await isPresent(closingPath(repo.recordsDir, 1))).toBe(false);
    expect(await sh(root, ["log", "-1", "--format=%s%n%b"])).toBe("records: cycle 1 closed\nthe reader is built");
    expect(await sh(root, ["status", "--porcelain", "--", "docs/records"])).toBe("");
  });

  test("leaves nothing to do when no close is pending", async () => {
    const { repo, root } = await cycling();
    const head = await sh(root, ["rev-parse", "HEAD"]);

    expect(await finishPendingClose(repo)).toBeUndefined();
    expect(await sh(root, ["rev-parse", "HEAD"])).toBe(head);
  });
});
