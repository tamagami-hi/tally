import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TallyError, messageOf } from "@tally/core";
import { z } from "zod";

export const STAMP_FILE = "build.json";

const REBUILD = "npm run build rebuilds it";

const stampSchema = z.object({ version: z.string().min(1), builtAt: z.string().min(1) });

const packageSchema = z.object({ version: z.string().min(1) });

export type BuildStamp = z.infer<typeof stampSchema>;

export interface BuildPlace {
  packageJson: string;
  dist: string | null;
}

export function buildPlaceOf(moduleUrl: string): BuildPlace {
  const file = fileURLToPath(moduleUrl);
  const folder = dirname(file);
  return { packageJson: resolve(folder, "..", "package.json"), dist: file.endsWith(".js") ? folder : null };
}

export async function sourceVersion(place: BuildPlace): Promise<string> {
  try {
    return packageSchema.parse(JSON.parse(await readFile(place.packageJson, "utf8"))).version;
  } catch (error: unknown) {
    throw new TallyError(`tally's command line has no readable version at ${place.packageJson} (${messageOf(error)}); reinstall or rebuild tally`);
  }
}

export async function readStamp(dist: string): Promise<BuildStamp | undefined> {
  try {
    return stampSchema.parse(JSON.parse(await readFile(join(dist, STAMP_FILE), "utf8")));
  } catch {
    return undefined;
  }
}

export async function writeStamp(place: BuildPlace, now: Date): Promise<BuildStamp> {
  if (place.dist === null) throw new TallyError("a build stamp is written into a build's dist folder, and this runs from source");
  const stamp = { version: await sourceVersion(place), builtAt: now.toISOString() };
  await writeFile(join(place.dist, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}

export async function staleWarning(place: BuildPlace): Promise<string | undefined> {
  if (place.dist === null) return undefined;
  const source = await sourceVersion(place).catch(() => undefined);
  if (source === undefined) return undefined;
  const stamp = await readStamp(place.dist);
  if (stamp === undefined) return `tally: this build has no stamp in ${place.dist}, so it may be older than its source, ${source}; ${REBUILD}`;
  if (stamp.version === source) return undefined;
  return `tally: this build is ${stamp.version}, built ${stamp.builtAt}, but its source is ${source}; ${REBUILD}`;
}
