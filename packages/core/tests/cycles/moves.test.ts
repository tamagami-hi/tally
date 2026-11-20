import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cycleDir } from "../../src/cycles/file.ts";
import { finishPendingClose } from "../../src/cycles/finish.ts";
import { logActivity } from "../../src/records/activity.ts";
import { AT, cycling } from "../support/cycling.ts";
import { OPERATIONS, pendingClose } from "../support/pending.ts";

const DAY = join("log", "2026-11-20.json");
const EVIDENCE = join("evidence", "A1.json");

const text = (path: string): Promise<string> => readFile(path, "utf8");

describe("a move replayed by a resumed close", () => {
  test("leaves the archived day alone, and a day file written since stays where it is", async () => {
    const made = await cycling();
    await pendingClose(made, OPERATIONS - 1);
    const archived = join(cycleDir(made.repo.recordsDir, 1), DAY);
    const before = await text(archived);

    await logActivity(made.repo, { session: "s-after", track: "main", agent: "operator", verb: "note_post" }, AT);
    await finishPendingClose(made.repo);

    expect(await text(archived)).toBe(before);
    expect(JSON.parse(await text(join(made.repo.recordsDir, DAY)))).toMatchObject({ events: [expect.objectContaining({ session: "s-after" })] });
  });

  test("never replaces a file the cycle's folder already holds", async () => {
    const made = await cycling();
    await pendingClose(made, OPERATIONS - 1);
    const archived = join(cycleDir(made.repo.recordsDir, 1), EVIDENCE);
    const before = await text(archived);
    await writeFile(join(made.repo.recordsDir, EVIDENCE), `${JSON.stringify({ schema: 1, milestone: "A1", records: [] })}\n`);

    await finishPendingClose(made.repo);

    expect(await text(archived)).toBe(before);
    expect(JSON.parse(await text(join(made.repo.recordsDir, EVIDENCE)))).toEqual({ schema: 1, milestone: "A1", records: [] });
  });
});
