import { z } from "zod";
import { TallyError } from "../errors.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import { statePath } from "../land/paths.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { StateFile } from "./file.ts";
import { assertMayWrite, type Session } from "./sessions.ts";

export const claimSchema = z.object({
  milestone: z.string().min(1),
  task: z.string().min(1),
  track: z.string().min(1),
  sessionId: z.string().min(1),
  agent: z.string().min(1),
  since: z.string(),
});

export type Claim = z.infer<typeof claimSchema>;

const claimsSchema = z.object({ claims: z.array(claimSchema) });

export const claimsFile = (repo: Repo): StateFile<{ claims: Claim[] }> =>
  new StateFile(statePath(repo, "claims.json"), claimsSchema, () => ({ claims: [] }));

export async function claimTask(repo: Repo, session: Session, ledger: Ledger, milestoneId: string, taskId: string, now = new Date()): Promise<Claim> {
  const milestone = findMilestone(ledger, milestoneId);
  const task = findTask(milestone, taskId);
  if (task === undefined) throw new TallyError(`'${taskId}' is not planned in ${milestoneId}`);
  if (task.status === "landed") throw new TallyError(`'${taskId}' landed at ${task.commit ?? "?"}; nothing to claim`);
  assertMayWrite(repo, session, task.track);
  return claimsFile(repo).update((state) => {
    const held = state.claims.find((c) => c.milestone === milestoneId && c.task === taskId);
    if (held !== undefined && held.sessionId !== session.id) {
      throw new TallyError(`'${taskId}' is claimed by ${held.agent} (session ${held.sessionId}, track ${held.track}) since ${held.since}`);
    }
    const own = state.claims.find((c) => c.sessionId === session.id && !(c.milestone === milestoneId && c.task === taskId));
    if (own !== undefined) throw new TallyError(`session ${session.id} already holds '${own.task}' in ${own.milestone}; release it first`);
    const claim: Claim = { milestone: milestoneId, task: taskId, track: task.track, sessionId: session.id, agent: session.agent, since: held?.since ?? now.toISOString() };
    const others = state.claims.filter((c) => !(c.milestone === milestoneId && c.task === taskId));
    return { value: { claims: [...others, claim] }, result: claim };
  });
}

export async function releaseClaim(repo: Repo, session: Session, milestoneId: string, taskId: string): Promise<Claim> {
  return claimsFile(repo).update((state) => {
    const held = state.claims.find((c) => c.milestone === milestoneId && c.task === taskId);
    if (held === undefined) throw new TallyError(`'${taskId}' in ${milestoneId} is not claimed`);
    if (held.sessionId !== session.id) throw new TallyError(`'${taskId}' is claimed by session ${held.sessionId}, not this one`);
    return { value: { claims: state.claims.filter((c) => c !== held) }, result: held };
  });
}

export async function releaseLanded(repo: Repo, milestoneId: string, taskId: string): Promise<Claim | null> {
  return claimsFile(repo).update((state) => {
    const held = state.claims.find((c) => c.milestone === milestoneId && c.task === taskId);
    return { value: { claims: state.claims.filter((c) => c !== held) }, result: held ?? null };
  });
}

export async function releaseClaimsOf(repo: Repo, sessionId: string): Promise<Claim[]> {
  return claimsFile(repo).update((state) => ({
    value: { claims: state.claims.filter((c) => c.sessionId !== sessionId) },
    result: state.claims.filter((c) => c.sessionId === sessionId),
  }));
}

export async function listClaims(repo: Repo): Promise<Claim[]> {
  return (await claimsFile(repo).read()).claims;
}
