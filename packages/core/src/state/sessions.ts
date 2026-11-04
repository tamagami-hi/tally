import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { currentBranch, worktrees } from "../git/refs.ts";
import { statePath, worktreeOf } from "../land/paths.ts";
import type { Repo } from "../store/records.ts";
import { StateFile } from "./file.ts";

export const sessionSchema = z.object({
  id: z.string().min(1),
  track: z.string().min(1),
  worktree: z.string().min(1),
  branch: z.string().min(1),
  agent: z.string().min(1),
  openedAt: z.string(),
  lastSeenAt: z.string(),
});

export type Session = z.infer<typeof sessionSchema>;

const sessionsSchema = z.object({ sessions: z.array(sessionSchema) });

export const sessionsFile = (repo: Repo): StateFile<{ sessions: Session[] }> =>
  new StateFile(statePath(repo, "sessions.json"), sessionsSchema, () => ({ sessions: [] }));

export interface OpenInput {
  worktree: string;
  track: string;
  agent: string;
}

export function isOperator(repo: Repo, session: Pick<Session, "track">): boolean {
  return session.track === repo.config.mainBranch;
}

async function expectedBinding(repo: Repo, track: string): Promise<{ worktree: string; branch: string }> {
  if (track === repo.config.mainBranch) return { worktree: repo.root, branch: repo.config.mainBranch };
  const found = repo.config.tracks.find((t) => t.name === track);
  if (found === undefined) {
    const known = [repo.config.mainBranch, ...repo.config.tracks.map((t) => t.name)].join(", ");
    throw new TallyError(`no track '${track}'; known: ${known}`);
  }
  return { worktree: worktreeOf(repo, found), branch: found.branch };
}

export async function openSession(repo: Repo, input: OpenInput, now = new Date()): Promise<Session> {
  const expected = await expectedBinding(repo, input.track);
  const given = resolve(input.worktree);
  if (given !== resolve(expected.worktree)) throw new TallyError(`${given} is not the worktree of track ${input.track} (${expected.worktree})`);
  const known = new Set([...(await worktrees(repo.root)).values()].map((p) => resolve(p)));
  if (!known.has(given)) throw new TallyError(`${given} is not a worktree of ${repo.root}`);
  const branch = await currentBranch(given);
  if (branch !== expected.branch) throw new TallyError(`worktree ${given} is not on branch ${expected.branch} (it is on ${branch === "" ? "no branch" : branch})`);
  const session: Session = { id: randomUUID(), track: input.track, worktree: given, branch, agent: input.agent, openedAt: now.toISOString(), lastSeenAt: now.toISOString() };
  await sessionsFile(repo).update((state) => ({ value: { sessions: [...state.sessions, session] }, result: undefined }));
  return session;
}

export async function getSession(repo: Repo, id: string, now = new Date()): Promise<Session> {
  return sessionsFile(repo).update((state) => {
    const found = state.sessions.find((s) => s.id === id);
    if (found === undefined) throw new TallyError(`no session ${id}; open one with session_open`);
    const touched = { ...found, lastSeenAt: now.toISOString() };
    return { value: { sessions: state.sessions.map((s) => (s.id === id ? touched : s)) }, result: touched };
  });
}

export async function closeSession(repo: Repo, id: string): Promise<Session> {
  return sessionsFile(repo).update((state) => {
    const found = state.sessions.find((s) => s.id === id);
    if (found === undefined) throw new TallyError(`no session ${id}`);
    return { value: { sessions: state.sessions.filter((s) => s.id !== id) }, result: found };
  });
}

export async function listSessions(repo: Repo): Promise<Session[]> {
  return (await sessionsFile(repo).read()).sessions;
}

export function assertMayWrite(repo: Repo, session: Session, track: string): void {
  if (isOperator(repo, session) || session.track === track) return;
  throw new TallyError(`session ${session.id} is bound to track ${session.track} and may not write track ${track}'s records`);
}
