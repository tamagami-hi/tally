import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import type { Exact } from "../schema/kept.ts";
import { readJson } from "../store/json.ts";
import type { Repo } from "../store/records.ts";

export const RELEASES_FILE = "releases.json";
export const MOST_RELEASE_NOTES = 2000;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

export const releaseSchema = z.looseObject({
  version: z.string().min(1),
  commit: z.string().min(7),
  at: z.string(),
  by: z.looseObject({ session: z.string().min(1), track: z.string().min(1), agent: z.string().min(1) }),
  notes: z.string().optional(),
});

export const releasesFileSchema = z.looseObject({
  schema: z.literal(1),
  releases: z.array(releaseSchema).default([]),
});

export type Release = Exact<z.infer<typeof releaseSchema>>;
export type ReleasesFile = Exact<z.infer<typeof releasesFileSchema>>;

export const releasesPath = (repo: Repo): string => join(repo.recordsDir, RELEASES_FILE);

export function assertVersion(version: string): void {
  if (!VERSION.test(version) || version.includes("..")) throw new TallyError(`'${version}' is not a version: it is letters, digits, '.', '_', '+' and '-', begins with a letter or a digit, and holds no '..'`);
}

export async function readReleases(repo: Repo): Promise<ReleasesFile> {
  try {
    return await readJson(releasesPath(repo), releasesFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, releases: [] };
    throw error;
  }
}
