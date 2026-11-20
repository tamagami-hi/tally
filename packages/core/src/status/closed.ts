import { dirname } from "node:path";
import { readCycles } from "../cycles/file.ts";
import type { Repo } from "../store/records.ts";
import { isOpen, readTracks } from "../tracks/file.ts";
import type { TrackRow } from "./tracks.ts";

export interface GitState {
  time: Date;
  tracks: TrackRow[];
  main: string;
  origin: string | null;
  unpushed: number;
  today: number;
}

const MS_PER_SECOND = 1000;

const baseOf = (view: Repo): string => dirname(dirname(view.recordsDir));

export async function closedState(view: Repo, cycle: number): Promise<GitState> {
  const record = (await readCycles(baseOf(view))).cycles.find((one) => one.n === cycle);
  const tracks = (await readTracks(view.recordsDir)).tracks.filter((track) => !isOpen(track)).map((track): TrackRow => ({
    branch: track.branch, track: track.name, path: track.worktree, head: "", subject: track.closedWhy ?? "", ct: Math.floor(Date.parse(track.closedAt ?? "") / MS_PER_SECOND) || 0,
    when: track.closedAt ?? "", ahead: 0, behind: 0, dirty: 0, files: [], isMain: false, ...(track.closedAt === undefined ? {} : { closedAt: track.closedAt }),
  }));
  return { time: record === undefined ? new Date(0) : new Date(record.closedAt), tracks, main: record?.to ?? "", origin: null, unpushed: 0, today: 0 };
}
