import { worktreeOf } from "../land/paths.ts";
import { listSessions } from "../state/sessions.ts";
import type { Repo } from "../store/records.ts";
import { isOpen, readableTracks } from "./file.ts";

export interface ListedTrack {
  name: string;
  branch: string;
  worktree: string;
  parent?: string;
  purpose?: string;
  paths?: string[];
  source: "config" | "opened";
  hasSession: boolean;
}

export async function listTracks(repo: Repo): Promise<ListedTrack[]> {
  const opened = new Map((await readableTracks(repo.recordsDir)).value.tracks.filter(isOpen).map((track) => [track.name, track]));
  const busy = new Set((await listSessions(repo)).map((session) => session.track));
  return repo.config.tracks.map((track) => {
    const record = opened.get(track.name);
    return {
      name: track.name,
      branch: track.branch,
      worktree: worktreeOf(repo, track),
      ...(track.parent === undefined ? {} : { parent: track.parent }),
      ...(record === undefined ? {} : { purpose: record.purpose }),
      ...(track.paths === undefined ? {} : { paths: [...track.paths] }),
      source: record === undefined ? "config" : "opened",
      hasSession: busy.has(track.name),
    };
  });
}
