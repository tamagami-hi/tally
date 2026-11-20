import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { assertNewMilestone } from "../../src/cycles/ids.ts";
import { SCHEMAS_061 } from "../fixtures/schemas-0.6.1.ts";
import { AT, cycling } from "../support/cycling.ts";

const raw = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

describe("after a close", () => {
  test("0.6.1's ledger, tracks and reviews schemas still read the current folder", async () => {
    const { repo, operator } = await cycling();
    await closeCycle(repo, operator, { summary: "done", said: "close it" }, AT);

    expect(SCHEMAS_061.ledger.safeParse(await raw(join(repo.recordsDir, "ledger.json"))).success).toBe(true);
    expect(SCHEMAS_061.tracks.safeParse(await raw(join(repo.recordsDir, "tracks.json"))).success).toBe(true);
    expect(SCHEMAS_061.reviews.safeParse(await raw(join(repo.recordsDir, "reviews.json"))).success).toBe(true);
  });

  test("a milestone's id is not used again: one a closed cycle holds is refused, naming the cycle", async () => {
    const { repo, operator } = await cycling();
    await closeCycle(repo, operator, { summary: "done", said: "close it" }, AT);

    await expect(assertNewMilestone(repo, "A1")).rejects.toThrow("milestone A1 was in cycle 1; an id is never used again, so pick another");
    await expect(assertNewMilestone(repo, "A3")).resolves.toBeUndefined();
  });
});
