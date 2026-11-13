import { TallyError } from "../errors.ts";
import { isActive, queueFile } from "../land/queue.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import { refOf } from "../ledger/refs.ts";
import { remove, type RemoveInput } from "../ledger/remove.ts";
import type { Waiter } from "../ledger/waits.ts";
import { listClaims, releaseClaim, type Claim } from "../state/claims.ts";
import { assertMayWrite, type Session } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import { listEvidence } from "./evidence.ts";
import { TALLY, tellWaiters } from "./tell.ts";

export interface TaskRemoved {
  message: string;
  released: Claim | null;
  evidenceKept: number;
  problem?: string;
}

async function assertFree(repo: Repo, { milestone, task }: RemoveInput, session: Session | undefined): Promise<Claim | undefined> {
  const claim = (await listClaims(repo)).find((held) => held.milestone === milestone && held.task === task);
  if (claim !== undefined && claim.sessionId !== session?.id) {
    throw new TallyError(`'${task}' in ${milestone} is held by ${claim.agent} on ${claim.track}; that session releases it first, or closes`);
  }
  const ticket = (await queueFile(repo).read()).tickets.find((one) => isActive(one) && one.target?.milestone === milestone && one.target.task === task);
  if (ticket !== undefined) throw new TallyError(`a landing in the queue (ticket ${ticket.id}) is to record '${task}' in ${milestone}; cancel it with land_cancel, or let it land`);
  return claim;
}

export async function removeTask(repo: Repo, input: RemoveInput, session?: Session): Promise<TaskRemoved> {
  const claim = await assertFree(repo, input, session);
  let waiters: Waiter[] = [];
  const changed = await new Records(repo).update((ledger) => {
    const track = findTask(findMilestone(ledger, input.milestone), input.task)?.track;
    if (session !== undefined && track !== undefined) assertMayWrite(repo, session, track);
    const removed = remove(ledger, input);
    waiters = removed.waiters;
    return removed;
  });
  const released = claim === undefined || session === undefined ? null : await releaseClaim(repo, session, input.milestone, input.task);
  const evidenceKept = (await listEvidence(repo, input.milestone, input.task)).length;
  const ref = refOf(input.milestone, input.task);
  const from = { track: session?.track ?? repo.config.mainBranch, agent: session?.agent ?? TALLY };
  const problem = await tellWaiters(repo, from, waiters, {
    ref,
    text: (labels) => `${ref} was removed (${input.why.trim()}); ${labels.join(", ")} still wait${labels.length === 1 ? "s" : ""} on it: clear the wait, or wait on another task`,
  });
  const kept = evidenceKept === 0 ? "" : `; its ${evidenceKept} run record${evidenceKept === 1 ? " stays" : "s stay"} in ${input.milestone}'s evidence`;
  return { message: `${changed}${kept}`, released, evidenceKept, ...(problem === undefined ? {} : { problem }) };
}
