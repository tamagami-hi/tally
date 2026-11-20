import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { finishPendingClose } from "../../src/cycles/finish.ts";
import { isOpen, readTracks } from "../../src/tracks/file.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT, bothFolders, isPending, listOf } from "../support/pending.ts";

describe("a close that meets a record file it cannot read", () => {
  test.each(["phases.json", "buildlog.json", "reviews.json", "context/notes.json", "tracks.json", "cycles.json"])("is refused by the file's name when %s does not parse, with nothing written and no track closed", async (file) => {
    const made = await cycling();
    await writeFile(join(made.repo.recordsDir, file), "{ not json");

    const refused = await closeCycle(made.repo, made.operator, CLOSE_INPUT, AT).then(() => "closed", (error: unknown) => String(error));
    const ledger = await bothFolders(made.repo, "ledger.json");

    expect(refused).toMatch(/(cycle 1|the cycle) was not closed: .*nothing was written: mend that file and call again/s);
    expect(refused).toContain(file.split("/").at(-1));
    expect(await isPending(made.repo)).toBe(false);
    expect(listOf<{ id: string }>(ledger.current, "milestones").map((one) => one.id)).toEqual(["A1", "A2"]);
    expect(ledger.cycle).toBeUndefined();
    await expect(finishPendingClose(made.repo)).resolves.toBeUndefined();
    if (file !== "tracks.json") expect((await readTracks(made.repo.recordsDir)).tracks.filter(isOpen).map((track) => track.name)).toEqual(["docs", "eng"]);
  });
});
