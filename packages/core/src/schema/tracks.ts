import { z } from "zod";

export const TRACKS_FILE = "tracks.json";
export const DEFAULT_WORKTREE_ROOT = ".temp/worktrees";
export const TRACK_BRANCH_PREFIX = "track/";

export const openedTrackSchema = z.object({
  name: z.string().min(1),
  branch: z.string().min(1),
  worktree: z.string().min(1),
  parent: z.string().min(1).optional(),
  purpose: z.string().min(1),
  paths: z.array(z.string().min(1)).optional(),
  openedBy: z.object({ track: z.string().min(1), agent: z.string().min(1) }),
  openedAt: z.string(),
  closedAt: z.string().optional(),
  closedBy: z.object({ track: z.string().min(1), agent: z.string().min(1) }).optional(),
  closedWhy: z.string().optional(),
});

export const tracksFileSchema = z.object({
  schema: z.literal(1),
  tracks: z.array(openedTrackSchema).default([]),
});

export type OpenedTrack = z.infer<typeof openedTrackSchema>;
export type TracksFile = z.infer<typeof tracksFileSchema>;
