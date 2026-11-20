import { mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeName } from "../records/handoffs.ts";
import { SCRATCH_ROOT } from "../state/scratch.ts";
import type { Repo } from "../store/records.ts";
import { CLOSED_FOLDER } from "../tracks/keep.ts";
import { isOpen, isPresent, readTracks } from "../tracks/file.ts";
import type { Move } from "./plan.ts";

const CLOSED = join(SCRATCH_ROOT, CLOSED_FOLDER);
const STAMPED = /^-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:-\d+)?$/;

export const keptFolder = (n: number): string => join(CLOSED, `cycle-${n}`);

const isTracksOwn = (own: string, name: string): boolean => name === own || (name.startsWith(own) && STAMPED.test(name.slice(own.length)));

export async function keptMovesOf(repo: Repo, n: number, archived: readonly string[]): Promise<Move[]> {
  const closed = (await readTracks(repo.recordsDir)).tracks.filter((track) => !isOpen(track) && archived.includes(track.name));
  const names = (await readdir(join(repo.root, CLOSED)).catch(() => [] as string[])).sort();
  const recorded = closed.flatMap((track) => track.keptFolders ?? []);
  const found = closed.filter((track) => track.keptFolders === undefined).flatMap((track) => names.filter((name) => isTracksOwn(safeName(track.name), name)).map((name) => join(CLOSED, name)));
  const from = [...new Set([...recorded, ...found])].sort();
  return from.map((path) => ({ from: path, to: join(keptFolder(n), path.slice(CLOSED.length + 1)) }));
}

export async function moveKept(repo: Repo, move: Move): Promise<void> {
  const to = join(repo.root, move.to);
  if (await isPresent(to)) return;
  const from = join(repo.root, move.from);
  if (!(await isPresent(from))) return;
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
}
