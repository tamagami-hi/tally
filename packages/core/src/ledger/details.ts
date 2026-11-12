import { TallyError } from "../errors.ts";
import type { Deliverable, Milestone, Task } from "../schema/ledger.ts";

export interface PlannedTask {
  id: string;
  brief?: string | undefined;
  paths?: readonly string[] | undefined;
  covers?: readonly string[] | undefined;
}

export const hasDetails = (task: PlannedTask): boolean => task.brief !== undefined || task.paths !== undefined || task.covers !== undefined;

export function distinctDeliverables(milestone: string, held: readonly Deliverable[], added: readonly Deliverable[]): Deliverable[] {
  const seen = new Set<string>();
  for (const { id } of added) {
    if (held.some((one) => one.id === id)) throw new TallyError(`${milestone} already delivers '${id}'; give the new deliverable another id`);
    if (seen.has(id)) throw new TallyError(`${milestone} would deliver '${id}' twice; give each deliverable its own id`);
    seen.add(id);
  }
  return [...held, ...added];
}

function assertCovers(milestone: Milestone, covers: readonly string[]): void {
  const known = (milestone.delivers ?? []).map((one) => one.id);
  const unknown = covers.filter((id) => !known.includes(id));
  if (unknown.length === 0) return;
  const delivered = known.length === 0 ? "nothing yet, add deliverables with milestone_deliver" : known.join(", ");
  throw new TallyError(`${milestone.id} delivers no '${unknown.join("', '")}'; it delivers: ${delivered}`);
}

export function withDetails(milestone: Milestone, task: Task, given: PlannedTask): Task {
  assertCovers(milestone, given.covers ?? []);
  const { brief: heldBrief, paths: heldPaths, covers: heldCovers, ...rest } = task;
  const brief = given.brief ?? heldBrief;
  const paths = given.paths ?? heldPaths;
  const covers = given.covers ?? heldCovers;
  return {
    ...rest,
    ...(brief === undefined || brief === "" ? {} : { brief }),
    ...(paths === undefined || paths.length === 0 ? {} : { paths: [...paths] }),
    ...(covers === undefined || covers.length === 0 ? {} : { covers: [...new Set(covers)] }),
  };
}
