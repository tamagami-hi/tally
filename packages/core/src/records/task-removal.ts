import { TallyError, messageOf } from "../errors.ts";
import { isActive, queueFile } from "../land/queue.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import { refOf } from "../ledger/refs.ts";
import { reasonOf, remove, type RemoveInput } from "../ledger/remove.ts";
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

interface Counted {
  count: number;
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

async function releasing(repo: Repo, session: Session, input: RemoveInput): Promise<{ released: Claim | null; problem?: string }> {
  try {
    return { released: await releaseClaim(repo, session, input.milestone, input.task) };
  } catch (error: unknown) {
    return { released: null, problem: `its claim was not released: ${messageOf(error)}` };
  }
}

async function counting(repo: Repo, input: RemoveInput): Promise<Counted> {
  try {
    return { count: (await listEvidence(repo, input.milestone, input.task)).length };
  } catch (error: unknown) {
    return { count: 0, problem: `its run records could not be counted: ${messageOf(error)}` };
  }
}

export async function removeTask(repo: Repo, input: RemoveInput, session?: Session): Promise<TaskRemoved> {
  let waiters: Waiter[] = [];
  let claim: Claim | undefined;
  const changed = await new Records(repo).update(async (ledger) => {
    const track = findTask(findMilestone(ledger, input.milestone), input.task)?.track;
    if (session !== undefined && track !== undefined) assertMayWrite(repo, session, track);
    const removed = remove(ledger, input);
    claim = await assertFree(repo, input, session);
    waiters = removed.waiters;
    return removed;
  });
  const freed = claim === undefined || session === undefined ? { released: null } : await releasing(repo, session, input);
  const evidence = await counting(repo, input);
  const ref = refOf(input.milestone, input.task);
  const from = { track: session?.track ?? repo.config.mainBranch, agent: session?.agent ?? TALLY };
  const untold = await tellWaiters(repo, from, waiters, {
    ref,
    text: (labels) => `${ref} was removed (${reasonOf(input.why)}); ${labels.join(", ")} still wait${labels.length === 1 ? "s" : ""} on it: clear the wait, or wait on another task`,
  });
  const kept = evidence.count === 0 ? "" : `; its ${evidence.count} run record${evidence.count === 1 ? " stays" : "s stay"} in ${input.milestone}'s evidence`;
  const problems = [freed.problem, evidence.problem, untold].filter((one): one is string => one !== undefined);
  return { message: `${changed}${kept}`, released: freed.released, evidenceKept: evidence.count, ...(problems.length === 0 ? {} : { problem: problems.join("; ") }) };
}
