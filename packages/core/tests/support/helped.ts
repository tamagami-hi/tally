import { stat } from "node:fs/promises";
import { openTrack } from "../../src/tracks/open.ts";
import { opening, type Opening } from "./opening.ts";

export interface Helped extends Opening {
  tree: string;
}

export async function helped(records: Parameters<typeof opening>[0] = {}, openedAt = new Date()): Promise<Helped> {
  const made = await opening(records);
  const opened = await openTrack(made.repo, made.data, { name: "helper", purpose: "split the reader" }, openedAt);
  return { ...made, repo: await made.fresh(), tree: opened.track.worktree };
}

export const isThere = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
