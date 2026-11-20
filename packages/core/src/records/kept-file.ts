import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { TallyError } from "../errors.ts";
import type { KeptFile } from "../schema/kept.ts";

export interface Allowed {
  base: string;
  folders: readonly string[];
  outside: (given: string) => string;
  missing: (path: string, given: string) => string;
}

export function missingFile(what: string, base: string, elsewhere: string): (path: string, given: string) => string {
  return (path, given) => {
    const said = `${what} does not exist: ${path}`;
    return isAbsolute(given) ? said : `${said}; a relative path is read against the session's worktree, ${base}; an absolute path under ${elsewhere} is accepted too`;
  };
}

const within = (folder: string, path: string): boolean => !relative(folder, path).startsWith("..");

const MEBIBYTE = 1024 * 1024;

async function placed(given: string, allowed: Allowed): Promise<string> {
  const absolute = isAbsolute(given) ? given : resolve(allowed.base, given);
  if (!allowed.folders.some((folder) => within(folder, absolute))) throw new TallyError(allowed.outside(given));
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw new TallyError(allowed.missing(absolute, given));
  }
  const folders = await Promise.all(allowed.folders.map((folder) => realpath(folder).catch(() => folder)));
  if (!folders.some((folder) => within(folder, real))) throw new TallyError(allowed.outside(given));
  return absolute;
}

export async function keptFile(given: string, allowed: Allowed): Promise<{ file: KeptFile; content: Buffer }> {
  const absolute = await placed(given, allowed);
  let content: Buffer;
  try {
    content = await readFile(absolute);
  } catch {
    throw new TallyError(allowed.missing(absolute, given));
  }
  return { file: { path: absolute, sha256: createHash("sha256").update(content).digest("hex"), bytes: (await stat(absolute)).size }, content };
}

export async function hashedFile(given: string, allowed: Allowed, most: { bytes: number; what: string }): Promise<KeptFile> {
  const absolute = await placed(given, allowed);
  const seen = await stat(absolute);
  if (!seen.isFile()) throw new TallyError(allowed.outside(given));
  if (seen.size > most.bytes) throw new TallyError(`${most.what} holds at most ${most.bytes / MEBIBYTE} MB; this one has ${Math.ceil(seen.size / MEBIBYTE)} MB`);
  const hash = createHash("sha256");
  await pipeline(createReadStream(absolute), hash);
  return { path: absolute, sha256: hash.digest("hex"), bytes: seen.size };
}
