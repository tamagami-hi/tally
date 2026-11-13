import { resolve } from "node:path";
import { worktreeOf } from "../land/paths.ts";
import type { OpenedTrack } from "../schema/tracks.ts";
import type { Repo } from "../store/records.ts";
import { isOpen, readTracks } from "./file.ts";

export async function closedTrackAt(repo: Repo, path: string): Promise<OpenedTrack | undefined> {
  const wanted = resolve(path);
  const closed = (await readTracks(repo.recordsDir)).tracks.filter((track) => !isOpen(track));
  return closed.filter((track) => resolve(worktreeOf(repo, track)) === wanted).at(-1);
}

export const closedMessage = (track: OpenedTrack): string => `track ${track.name} was closed on ${track.closedAt ?? "an earlier day"} because its work had landed; new work needs a new track (track_open)`;
