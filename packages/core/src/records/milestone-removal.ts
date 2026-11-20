import { TallyError, messageOf } from "../errors.ts";
import { isActive, queueFile } from "../land/queue.ts";
import { findMilestone } from "../ledger/items.ts";
import { refOf } from "../ledger/refs.ts";
import { MAX_REASON, reasonOf } from "../ledger/remove.ts";
import { waitersOn, type Waiter } from "../ledger/waits.ts";
import type { Ledger, Milestone } from "../schema/ledger.ts";
import { listClaims } from "../state/claims.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import { listEvidence } from "./evidence.ts";
import { tellWaiters } from "./tell.ts";

export interface MilestoneRemoveInput {
  milestone: string;
  why: string;
  decision?: string | undefined;
}

export interface MilestoneRemoved {
  message: string;
  tasks: string[];
  evidenceKept: number;
  problem?: string;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

function checkedWhy(milestone: string, why: string): string {
  const reason = reasonOf(why);
  if (reason === "") throw new TallyError(`say why ${milestone} is removed: the reason goes in the record's commit`);
  if (reason.length > MAX_REASON) throw new TallyError(`a reason is one line of at most ${MAX_REASON} characters; this one has ${reason.length}`);
  return reason;
}

function assertNoneLanded(milestone: Milestone): void {
  const landed = milestone.tasks.filter((task) => task.status === "landed").map((task) => `'${task.id}'`);
  if (landed.length > 0) throw new TallyError(`${milestone.id} has ${landed.length === 1 ? "a landed task" : "landed tasks"} (${landed.join(", ")}): a milestone with a landed task is the record of its commits and stays; drop what it still owes with milestone_edit`);
}

async function assertNoneHeld(repo: Repo, milestone: string): Promise<void> {
  const claim = (await listClaims(repo)).find((held) => held.milestone === milestone);
  if (claim !== undefined) throw new TallyError(`'${claim.task}' in ${milestone} is held by ${claim.agent} on ${claim.track}; that session releases it first, or closes`);
  const ticket = (await queueFile(repo).read()).tickets.find((one) => isActive(one) && one.target?.milestone === milestone);
  if (ticket !== undefined) throw new TallyError(`a landing in the queue (ticket ${ticket.id}) is to record '${ticket.target?.task ?? ""}' in ${milestone}; cancel it with land_cancel, or let it land`);
}

function outsideWaiters(ledger: Ledger, milestone: Milestone): Waiter[] {
  const inside = new Set(milestone.tasks.map((task) => `${milestone.id} '${task.id}'`));
  return milestone.tasks.flatMap((task) => waitersOn(ledger, refOf(milestone.id, task.id))).filter((waiter) => !inside.has(waiter.label));
}

async function evidenceKept(repo: Repo, milestone: string): Promise<{ count: number; problem?: string }> {
  try {
    return { count: (await listEvidence(repo, milestone)).length };
  } catch (error: unknown) {
    return { count: 0, problem: `its run records could not be counted: ${messageOf(error)}` };
  }
}

export async function removeMilestone(repo: Repo, input: MilestoneRemoveInput, session: Session): Promise<MilestoneRemoved> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session removes a milestone; a track asks with question_add");
  const why = checkedWhy(input.milestone, input.why);
  const under = input.decision === undefined || input.decision.trim() === "" ? "" : `; under ${input.decision.trim()}`;
  let waiters: Waiter[] = [];
  let tasks: string[] = [];
  const changed = await new Records(repo).update(async (ledger) => {
    const milestone = findMilestone(ledger, input.milestone);
    assertNoneLanded(milestone);
    await assertNoneHeld(repo, milestone.id);
    waiters = outsideWaiters(ledger, milestone);
    tasks = milestone.tasks.map((task) => task.id);
    const waiting = waiters.length === 0 ? "" : `; still waiting on its tasks: ${[...new Set(waiters.map((waiter) => waiter.label))].join(", ")}`;
    return { ledger: { ...ledger, milestones: ledger.milestones.filter((one) => one !== milestone) }, message: `${milestone.id}: removed with its ${plural(tasks.length, "planned task", "planned tasks")} (${why}${under})${waiting}` };
  });
  const evidence = await evidenceKept(repo, input.milestone);
  const untold = await tellWaiters(repo, { track: session.track, agent: session.agent }, waiters, {
    ref: input.milestone,
    text: (labels) => `${input.milestone} was removed (${why}); ${labels.join(", ")} still wait${labels.length === 1 ? "s" : ""} on its tasks: clear the wait, or wait on another task`,
  });
  const kept = evidence.count === 0 ? "" : `; its ${plural(evidence.count, "run record stays", "run records stay")} in ${input.milestone}'s evidence`;
  const problems = [evidence.problem, untold].filter((one): one is string => one !== undefined);
  return { message: `${changed}${kept}`, tasks, evidenceKept: evidence.count, ...(problems.length === 0 ? {} : { problem: problems.join("; ") }) };
}
