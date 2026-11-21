import { access } from "node:fs/promises";
import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { TRACKS_FILE, tracksFileSchema, type OpenedTrack, type TracksFile } from "../schema/tracks.ts";
import { readJson, tolerated, writeJsonAtomic, type Tolerated } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { refuseClosedFolder } from "../cycles/file.ts";

export const tracksPath = (recordsDir: string): string => join(recordsDir, TRACKS_FILE);

export const isOpen = (track: OpenedTrack): boolean => track.closedAt === undefined;

export async function isPresent(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readTracks(recordsDir: string): Promise<TracksFile> {
  try {
    return await readJson(tracksPath(recordsDir), tracksFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, tracks: [] };
    throw error;
  }
}

export const readableTracks = (recordsDir: string): Promise<Tolerated<TracksFile>> => tolerated(readTracks(recordsDir), { schema: 1, tracks: [] });

export async function changeTracks<R>(recordsDir: string, change: (file: TracksFile) => Promise<{ file: TracksFile; result: R }>): Promise<R> {
  refuseClosedFolder(recordsDir);
  const path = tracksPath(recordsDir);
  return withLock(path, async () => {
    const { file, result } = await change(await readTracks(recordsDir));
    await writeJsonAtomic(path, tracksFileSchema.parse(file));
    return result;
  });
}
