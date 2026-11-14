import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TallyError } from "../errors.ts";
import type { KeptFile } from "../schema/reviews.ts";

export interface Allowed {
  base: string;
  folders: readonly string[];
  outside: (given: string) => string;
  missing: (path: string) => string;
}

const within = (folder: string, path: string): boolean => !relative(folder, path).startsWith("..");

export async function keptFile(given: string, allowed: Allowed): Promise<{ file: KeptFile; content: Buffer }> {
  const absolute = isAbsolute(given) ? given : resolve(allowed.base, given);
  if (!allowed.folders.some((folder) => within(folder, absolute))) throw new TallyError(allowed.outside(given));
  let content: Buffer;
  try {
    content = await readFile(absolute);
  } catch {
    throw new TallyError(allowed.missing(absolute));
  }
  const real = await realpath(absolute);
  const folders = await Promise.all(allowed.folders.map((folder) => realpath(folder).catch(() => folder)));
  if (!folders.some((folder) => within(folder, real))) throw new TallyError(allowed.outside(given));
  return { file: { path: absolute, sha256: createHash("sha256").update(content).digest("hex"), bytes: (await stat(absolute)).size }, content };
}
