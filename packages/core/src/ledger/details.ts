import { TallyError } from "../errors.ts";
import { checkedAccept } from "../records/accept.ts";
import type { Deliverable, Milestone, Task } from "../schema/ledger.ts";

export interface PlannedTask {
  id: string;
  brief?: string | undefined;
  paths?: readonly string[] | undefined;
  covers?: readonly string[] | undefined;
  cites?: readonly string[] | undefined;
  accept?: readonly string[] | undefined;
  under?: readonly string[] | undefined;
}

export const hasDetails = (task: PlannedTask): boolean => task.brief !== undefined || task.paths !== undefined || task.covers !== undefined || task.cites !== undefined || task.accept !== undefined || task.under !== undefined;

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
  if (given.accept !== undefined) checkedAccept(given.accept);
  const { brief: heldBrief, paths: heldPaths, covers: heldCovers, cites: heldCites, accept: heldAccept, under: heldUnder, ...rest } = task;
  const brief = given.brief ?? heldBrief;
  const paths = given.paths ?? heldPaths;
  const covers = given.covers ?? heldCovers;
  const cites = given.cites ?? heldCites;
  const accept = given.accept ?? heldAccept;
  const under = given.under ?? heldUnder;
  return {
    ...rest,
    ...(brief === undefined || brief === "" ? {} : { brief }),
    ...(paths === undefined || paths.length === 0 ? {} : { paths: [...paths] }),
    ...(covers === undefined || covers.length === 0 ? {} : { covers: [...new Set(covers)] }),
    ...(cites === undefined || cites.length === 0 ? {} : { cites: [...new Set(cites)] }),
    ...(accept === undefined || accept.length === 0 ? {} : { accept: [...accept] }),
    ...(under === undefined || under.length === 0 ? {} : { under: [...new Set(under)] }),
  };
}
