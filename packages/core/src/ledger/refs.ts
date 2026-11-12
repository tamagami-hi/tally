import { TallyError } from "../errors.ts";
import type { Ledger, Task } from "../schema/ledger.ts";

const SEPARATOR = ":";

export interface TaskRef {
  milestone: string;
  task: string;
}

export const refOf = (milestone: string, task: string): string => `${milestone}${SEPARATOR}${task}`;

function split(ref: string): TaskRef | undefined {
  const cut = ref.indexOf(SEPARATOR);
  return cut <= 0 || cut === ref.length - 1 ? undefined : { milestone: ref.slice(0, cut), task: ref.slice(cut + 1) };
}

export function parseRef(ref: string, field: string): TaskRef {
  const found = split(ref);
  if (found === undefined) throw new TallyError(`${field} takes MILESTONE:TASK, not '${ref}'`);
  return found;
}

export function taskAt(ledger: Pick<Ledger, "milestones">, ref: string): Task | undefined {
  const found = split(ref);
  if (found === undefined) return undefined;
  return ledger.milestones.find((milestone) => milestone.id === found.milestone)?.tasks.find((task) => task.id === found.task);
}
