import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { TRACKS_FILE, tracksFileSchema, type OpenedTrack, type TracksFile } from "../schema/tracks.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";

export const tracksPath = (recordsDir: string): string => join(recordsDir, TRACKS_FILE);

export const isOpen = (track: OpenedTrack): boolean => track.closedAt === undefined;

export async function readTracks(recordsDir: string): Promise<TracksFile> {
  try {
    return await readJson(tracksPath(recordsDir), tracksFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, tracks: [] };
    throw error;
  }
}

export function changeTracks<R>(recordsDir: string, change: (file: TracksFile) => Promise<{ file: TracksFile; result: R }>): Promise<R> {
  const path = tracksPath(recordsDir);
  return withLock(path, async () => {
    const { file, result } = await change(await readTracks(recordsDir));
    await writeJsonAtomic(path, tracksFileSchema.parse(file));
    return result;
  });
}
