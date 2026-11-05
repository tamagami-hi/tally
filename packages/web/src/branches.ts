import type { CSSProperties } from "react";
import type { EvidenceIndex, LiveState, TrackRow } from "./types.ts";

export const BRANCH_HUES = 8;

const MAIN_COLOUR = "var(--accent)";
const QUIET_COLOUR = "var(--idle)";
const USUAL_MAIN = "main";
const MS_PER_SECOND = 1000;

const RANK_MAIN = 2;
const RANK_LIVE = 1;
const RANK_IDLE = 0;

export type BranchColours = ReadonlyMap<string, string>;

type Named = Pick<TrackRow, "branch" | "isMain">;

export const mainOf = (tracks: readonly Named[]): string => tracks.find((track) => track.isMain)?.branch ?? USUAL_MAIN;

export function branchColours(tracks: readonly Named[]): BranchColours {
  const names = tracks.filter((track) => !track.isMain).map((track) => track.branch).sort();
  return new Map([[mainOf(tracks), MAIN_COLOUR], ...names.map((name, index): [string, string] => [name, `var(--branch-${index % BRANCH_HUES})`])]);
}

export const colourOf = (colours: BranchColours, branch: string | null): string => (branch === null ? QUIET_COLOUR : (colours.get(branch) ?? QUIET_COLOUR));

export const paintOf = (colours: BranchColours, branch: string | null): CSSProperties => ({ "--branch": colourOf(colours, branch) }) as CSSProperties;

function timeOf(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
}

function newestEvents(state: LiveState | undefined, evidence: EvidenceIndex | undefined): Map<string, number> {
  const events: [string, string][] = [
    ...(state?.sessions ?? []).map((session): [string, string] => [session.track, session.openedAt]),
    ...(state?.claims ?? []).map((claim): [string, string] => [claim.track, claim.since]),
    ...(state?.locks ?? []).map((lock): [string, string] => [lock.track, lock.since]),
    ...(evidence?.milestones ?? []).flatMap((milestone) => milestone.records.map((record): [string, string] => [record.track, record.started])),
  ];
  const newest = new Map<string, number>();
  for (const [track, at] of events) newest.set(track, Math.max(newest.get(track) ?? 0, timeOf(at)));
  return newest;
}

export function rankBranches(tracks: readonly TrackRow[], state: LiveState | undefined, evidence: EvidenceIndex | undefined): TrackRow[] {
  const events = newestEvents(state, evidence);
  const live = new Set([...(state?.sessions ?? []), ...(state?.claims ?? [])].map((held) => held.track));
  const lastActive = (track: TrackRow): number => Math.max(track.ct * MS_PER_SECOND, events.get(track.track) ?? 0);
  const rank = (track: TrackRow): number => (track.isMain ? RANK_MAIN : live.has(track.track) ? RANK_LIVE : RANK_IDLE);
  return [...tracks].sort((a, b) => rank(b) - rank(a) || lastActive(b) - lastActive(a));
}
