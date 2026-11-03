import { isAbsolute, join } from "node:path";
import { TallyError } from "../errors.ts";
import { gitMust } from "../git/run.ts";
import type { Config, Track } from "../schema/config.ts";
import type { Repo } from "../store/records.ts";

export const STATE_DIR = ".temp/tally/state";

export function statePath(repo: Repo, ...parts: string[]): string {
  return join(repo.root, STATE_DIR, ...parts);
}

export function trackOf(config: Config, name: string): Track {
  const track = config.tracks.find((t) => t.name === name);
  if (track === undefined) {
    throw new TallyError(`no track '${name}'; known: ${config.tracks.map((t) => t.name).join(", ")}`);
  }
  return track;
}

export function worktreeOf(repo: Repo, track: Track): string {
  return isAbsolute(track.worktree) ? track.worktree : join(repo.root, track.worktree);
}

export async function fingerprint(dir: string, config: Config): Promise<string> {
  const excludes = config.fingerprint.exclude.map((pattern) => `:(exclude)${pattern}`);
  return gitMust(dir, ["log", "-1", "--format=%h", "--", ...config.fingerprint.paths, ...excludes]);
}

export function isDocumentation(path: string, config: Config): boolean {
  return path.endsWith(".md") || path.startsWith(`${config.docsDir}/`);
}
