import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { changePhases, phasesPath } from "../../src/phases/file.ts";
import { changeTracks, tracksPath } from "../../src/tracks/file.ts";
import { tmpDir } from "../support/tmp.ts";

const AT = "2026-11-21T08:00:00.000Z";
const who = (session: string) => ({ track: "main", agent: "operator", session });

const written = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

describe("the small objects that say who", () => {
  test("on a track keep a key a later build added, when the file is written back", async () => {
    const dir = await tmpDir();
    const track = { name: "data", branch: "track/data", worktree: ".temp/worktrees/data", purpose: "the data layer", openedBy: who("s-1"), openedAt: AT, closedAt: AT, closedBy: who("s-2"), widened: [{ paths: ["src/data"], by: who("s-3"), at: AT }] };
    await writeFile(tracksPath(dir), JSON.stringify({ schema: 1, tracks: [track] }));

    await changeTracks(dir, async (file) => ({ file, result: undefined }));

    expect(await written(tracksPath(dir))).toEqual({ schema: 1, tracks: [track] });
  });

  test("on a phase keep a key a later build added, when the file is written back", async () => {
    const dir = await tmpDir();
    const phase = { id: "C", name: "write", openedAt: AT, openedBy: who("s-4"), closedAt: AT, closedBy: who("s-5"), summary: "written" };
    await writeFile(phasesPath(dir), JSON.stringify({ schema: 1, phases: [phase] }));

    await changePhases(dir, (file) => ({ file, result: undefined }));

    expect(await written(phasesPath(dir))).toEqual({ schema: 1, phases: [phase] });
  });
});
