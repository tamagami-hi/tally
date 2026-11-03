import { TallyError } from "../errors.ts";
import type { Ledger, Milestone, Task } from "../schema/ledger.ts";

export const SHORT = 7;

export function isClose(task: Pick<Task, "id">): boolean {
  return task.id.toLowerCase().endsWith("close");
}

export function isUnfinishedClose(task: Task): boolean {
  return isClose(task) && task.status !== "landed";
}

export function keepCloseLast(tasks: readonly Task[]): Task[] {
  return [...tasks.filter((task) => !isUnfinishedClose(task)), ...tasks.filter(isUnfinishedClose)];
}

export function addTask(tasks: readonly Task[], task: Task): Task[] {
  const ordered = keepCloseLast(tasks);
  const last = ordered[ordered.length - 1];
  if (last !== undefined && isClose(last) && !isClose(task)) {
    return [...ordered.slice(0, -1), task, last];
  }
  return [...ordered, task];
}

export function findMilestone(ledger: Ledger, id: string): Milestone {
  const found = ledger.milestones.find((milestone) => milestone.id === id);
  if (found === undefined) {
    const known = ledger.milestones.map((milestone) => milestone.id).join(", ");
    throw new TallyError(`no milestone '${id}'; known: ${known}`);
  }
  return found;
}

export function findTask(milestone: Milestone, id: string): Task | undefined {
  return milestone.tasks.find((task) => task.id === id);
}

export function replaceMilestone(ledger: Ledger, milestone: Milestone): Ledger {
  return { ...ledger, milestones: ledger.milestones.map((m) => (m.id === milestone.id ? milestone : m)) };
}

export function knownCommits(ledger: Ledger): Set<string> {
  const known = new Set(ledger.other.map((entry) => entry.commit.slice(0, SHORT)));
  for (const milestone of ledger.milestones) {
    for (const task of milestone.tasks) {
      for (const commit of [task.commit, ...task.also]) {
        if (commit !== undefined) known.add(commit.slice(0, SHORT));
      }
    }
  }
  return known;
}
