import { z } from "zod";
import { TallyError } from "../errors.ts";
import { statePath } from "../land/paths.ts";
import type { Repo } from "../store/records.ts";
import { StateFile } from "./file.ts";
import type { Session } from "./sessions.ts";

export const heldLockSchema = z.object({
  name: z.string().min(1),
  sessionId: z.string().min(1),
  agent: z.string().min(1),
  track: z.string().min(1),
  note: z.string(),
  since: z.string(),
});

export type HeldLock = z.infer<typeof heldLockSchema>;

const locksSchema = z.object({ locks: z.array(heldLockSchema) });

export const locksFile = (repo: Repo): StateFile<{ locks: HeldLock[] }> =>
  new StateFile(statePath(repo, "locks.json"), locksSchema, () => ({ locks: [] }));

export async function acquireLock(repo: Repo, session: Session, name: string, note: string, now = new Date()): Promise<HeldLock> {
  if (!repo.config.locks.includes(name)) throw new TallyError(`no lock '${name}'; known: ${repo.config.locks.join(", ")}`);
  return locksFile(repo).update((state) => {
    const held = state.locks.find((l) => l.name === name);
    if (held !== undefined && held.sessionId !== session.id) {
      throw new TallyError(`'${name}' is held by ${held.agent} (session ${held.sessionId}, track ${held.track}) since ${held.since}: ${held.note}`);
    }
    const lock: HeldLock = { name, sessionId: session.id, agent: session.agent, track: session.track, note, since: held?.since ?? now.toISOString() };
    return { value: { locks: [...state.locks.filter((l) => l.name !== name), lock] }, result: lock };
  });
}

export async function releaseLock(repo: Repo, session: Session, name: string): Promise<HeldLock> {
  return locksFile(repo).update((state) => {
    const held = state.locks.find((l) => l.name === name);
    if (held === undefined) throw new TallyError(`'${name}' is not held`);
    if (held.sessionId !== session.id) throw new TallyError(`'${name}' is held by session ${held.sessionId}, not this one`);
    return { value: { locks: state.locks.filter((l) => l !== held) }, result: held };
  });
}

export async function releaseLocksOf(repo: Repo, sessionId: string): Promise<HeldLock[]> {
  return locksFile(repo).update((state) => ({
    value: { locks: state.locks.filter((l) => l.sessionId !== sessionId) },
    result: state.locks.filter((l) => l.sessionId === sessionId),
  }));
}

export async function listLocks(repo: Repo): Promise<HeldLock[]> {
  return (await locksFile(repo).read()).locks;
}
