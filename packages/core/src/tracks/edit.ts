import { TallyError } from "../errors.ts";
import { overlaps } from "../context/match.ts";
import { commitRecords } from "../records/commit.ts";
import type { OpenedTrack, TracksFile } from "../schema/tracks.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { CONFIG_FILE, reopenRepo, type Repo } from "../store/records.ts";
import { changeTracks, isOpen } from "./file.ts";
import { assertRelative, assertWithinParent } from "./open.ts";

export interface Declared {
  track: string;
  shared: string[];
}

export interface TrackEditInput {
  name: string;
  addPaths?: readonly string[] | undefined;
  purpose?: string | undefined;
}

export interface TrackEdited {
  track: OpenedTrack;
  paths: string[] | undefined;
  declared: Declared[];
  unlimited?: string;
  commit: string | null;
}

const trimmedPath = (path: string): string => path.trim().replace(/\/+$/, "");

function sharedPaths(ours: readonly string[], theirs: readonly string[]): string[] {
  const shared = ours.flatMap((mine) => theirs.flatMap((other) => {
    if (overlaps(mine, other)) return [mine];
    return overlaps(other, mine) ? [other] : [];
  }));
  return [...new Set(shared)];
}

export async function declaredOverlaps(repo: Repo, name: string, paths: readonly string[] | undefined): Promise<Declared[]> {
  if (paths === undefined || paths.length === 0) return [];
  const tracks = (await reopenRepo(repo)).config.tracks.filter((track) => track.name !== name && track.paths !== undefined && track.paths.length > 0);
  return tracks.flatMap((track) => {
    const shared = sharedPaths(paths, track.paths ?? []);
    return shared.length === 0 ? [] : [{ track: track.name, shared }];
  });
}

function editable(repo: Repo, session: Session, file: TracksFile, name: string): OpenedTrack {
  const track = file.tracks.find((one) => one.name === name && isOpen(one));
  if (track === undefined && repo.config.tracks.some((one) => one.name === name)) throw new TallyError(`track ${name} is listed in ${CONFIG_FILE}; repo_configure changes it`);
  if (track === undefined) throw new TallyError(`no open track '${name}'; track_list names them`);
  if (isOperator(repo, session) || (track.parent !== undefined && track.parent === session.track)) return track;
  throw new TallyError(`only an operator session or a session of its parent track (${track.parent ?? "it has none"}) edits track ${name}`);
}

function widenedTrack(repo: Repo, track: OpenedTrack, input: TrackEditInput, by: Session, at: string): { track: OpenedTrack; unlimited?: string } {
  const purpose = input.purpose?.trim();
  if (purpose === "") throw new TallyError("a track's purpose is a line saying what it is for, not empty");
  const named = purpose === undefined ? track : { ...track, purpose };
  if (input.addPaths === undefined || input.addPaths.length === 0) return { track: named };
  if (track.paths === undefined || track.paths.length === 0) return { track: named, unlimited: `track ${track.name} has no paths, so it may already land any file; nothing was widened` };
  assertRelative(input.addPaths);
  const added = [...new Set(input.addPaths.map(trimmedPath))].filter((path) => path !== "" && !track.paths?.includes(path));
  assertWithinParent(repo, track.name, track.parent, added);
  if (added.length === 0) return { track: named };
  const widened = [...(track.widened ?? []), { paths: added, by: { track: by.track, agent: by.agent }, at }];
  return { track: { ...named, paths: [...track.paths, ...added], widened } };
}

export async function editTrack(repo: Repo, session: Session, input: TrackEditInput, now = new Date()): Promise<TrackEdited> {
  if (input.addPaths === undefined && input.purpose === undefined) throw new TallyError(`give addPaths or purpose: nothing would change track ${input.name}`);
  const fresh = await reopenRepo(repo);
  const edited = await changeTracks(fresh.recordsDir, async (file) => {
    const track = editable(fresh, session, file, input.name);
    const changed = widenedTrack(fresh, track, input, session, now.toISOString());
    return { file: { ...file, tracks: file.tracks.map((one) => (one === track ? changed.track : one)) }, result: changed };
  });
  const commit = await commitRecords(fresh, `track ${input.name} edited by ${session.agent}`);
  const paths = edited.track.paths === undefined ? undefined : [...edited.track.paths];
  return { track: edited.track, paths, declared: await declaredOverlaps(fresh, input.name, paths), ...(edited.unlimited === undefined ? {} : { unlimited: edited.unlimited }), commit };
}
