import { access, mkdir } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { cycleDir, cyclesPath, writeCycles } from "../../src/cycles/file.ts";
import { changePhases, phasesPath } from "../../src/phases/file.ts";
import { changeTracks, tracksPath } from "../../src/tracks/file.ts";
import { tmpDir } from "../support/tmp.ts";

const READ_ONLY = /^cycle 2 is closed, and a closed cycle is read only: /;

const present = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

async function closedFolder(): Promise<{ current: string; closed: string }> {
  const current = await tmpDir();
  const closed = cycleDir(current, 2);
  await mkdir(closed, { recursive: true });
  return { current, closed };
}

describe("the writers of tracks.json, phases.json and cycles.json", () => {
  test("refuse a closed cycle's folder, and write nothing there", async () => {
    const { closed } = await closedFolder();

    await expect(changeTracks(closed, async (file) => ({ file, result: undefined }))).rejects.toThrow(READ_ONLY);
    await expect(changePhases(closed, (file) => ({ file, result: undefined }))).rejects.toThrow(READ_ONLY);
    await expect(writeCycles(closed, { schema: 1, current: 3, cycles: [] })).rejects.toThrow(READ_ONLY);

    expect(await Promise.all([tracksPath(closed), phasesPath(closed), cyclesPath(closed)].map(present))).toEqual([false, false, false]);
  });

  test("still write the current folder", async () => {
    const { current } = await closedFolder();

    await changeTracks(current, async (file) => ({ file, result: undefined }));
    await changePhases(current, (file) => ({ file, result: undefined }));
    await writeCycles(current, { schema: 1, current: 3, cycles: [] });

    expect(await Promise.all([tracksPath(current), phasesPath(current), cyclesPath(current)].map(present))).toEqual([true, true, true]);
  });
});
