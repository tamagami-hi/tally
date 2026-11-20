import { TallyError } from "../errors.ts";
import type { Deliverable, Ledger, Milestone } from "../schema/ledger.ts";
import { findMilestone, replaceMilestone } from "./items.ts";
import type { Changed } from "./ops.ts";
import { MAX_REASON, reasonOf } from "./remove.ts";

export interface DropInput {
  id: string;
  why: string;
  decision?: string | undefined;
}

export interface MilestoneEdit {
  milestone: string;
  name?: string | undefined;
  waits?: string | null | undefined;
  drop?: readonly DropInput[] | undefined;
}

export interface Author {
  track: string;
  agent: string;
}

const MOST_DECISION = 200;

function checkedName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new TallyError("a milestone's name is a few words, not empty");
  return trimmed;
}

function checkedWhy(id: string, why: string): string {
  const reason = reasonOf(why);
  if (reason === "") throw new TallyError(`say why ${id} is dropped: the reason stays on the deliverable`);
  if (reason.length > MAX_REASON) throw new TallyError(`a reason is one line of at most ${MAX_REASON} characters; this one has ${reason.length}`);
  return reason;
}

function checkedDecision(decision: string | undefined): string | undefined {
  const id = decision?.trim();
  if (id === undefined) return undefined;
  if (id === "" || id.length > MOST_DECISION) throw new TallyError(`a decision is named by its id, 1 to ${MOST_DECISION} characters`);
  return id;
}

function droppedFrom(milestone: Milestone, drops: readonly DropInput[], by: Author, at: string): Deliverable[] {
  const delivers = milestone.delivers ?? [];
  const known = delivers.map((one) => one.id).join(", ") || "none";
  const asked = new Map(drops.map((drop) => [drop.id, drop]));
  for (const { id } of drops) {
    const found = delivers.find((one) => one.id === id);
    if (found === undefined) throw new TallyError(`${milestone.id} has no deliverable ${id}; its deliverables: ${known}`);
    if (found.dropped !== undefined) throw new TallyError(`${milestone.id}'s deliverable ${id} was dropped at ${found.dropped.at} (${found.dropped.why})`);
    const landed = milestone.tasks.find((task) => task.status === "landed" && (task.covers ?? []).includes(id));
    if (landed !== undefined) throw new TallyError(`${milestone.id}'s deliverable ${id} is covered by '${landed.id}', which landed; a landed deliverable cannot be dropped`);
  }
  return delivers.map((one) => {
    const drop = asked.get(one.id);
    if (drop === undefined) return one;
    const decision = checkedDecision(drop.decision);
    return { ...one, dropped: { why: checkedWhy(one.id, drop.why), ...(decision === undefined ? {} : { decision }), by: { track: by.track, agent: by.agent }, at } };
  });
}

function droppedLine(delivers: readonly Deliverable[], drops: readonly DropInput[]): string {
  const said = drops.map(({ id }) => {
    const dropped = delivers.find((one) => one.id === id)?.dropped;
    const under = dropped?.decision === undefined ? "" : `; under ${dropped.decision}`;
    return `${id} (${dropped?.why ?? ""}${under})`;
  });
  return `dropped ${said.join(", ")}`;
}

export function editMilestone(ledger: Ledger, input: MilestoneEdit, by: Author, at: string): Changed {
  const milestone = findMilestone(ledger, input.milestone);
  const drops = input.drop ?? [];
  if (input.name === undefined && input.waits === undefined && drops.length === 0) throw new TallyError(`give name, waits or drop: nothing would change ${input.milestone}`);
  const name = input.name === undefined ? milestone.name : checkedName(input.name);
  const delivers = drops.length === 0 ? milestone.delivers : droppedFrom(milestone, drops, by, at);
  const { waits: _old, ...rest } = milestone;
  const waits = input.waits === undefined ? milestone.waits : input.waits === null ? undefined : input.waits.trim();
  if (waits === "") throw new TallyError("a wait is a line saying what the milestone waits for; give null to clear it");
  const edited: Milestone = { ...rest, name, ...(waits === undefined ? {} : { waits }), ...(delivers === undefined ? {} : { delivers }) };
  const said = [
    ...(input.name === undefined ? [] : [`renamed to '${name}'`]),
    ...(input.waits === undefined ? [] : [input.waits === null ? "no longer waits" : `waits for ${waits ?? ""}`]),
    ...(drops.length === 0 ? [] : [droppedLine(delivers ?? [], drops)]),
  ];
  return { ledger: replaceMilestone(ledger, edited), message: `${input.milestone}: ${said.join("; ")}` };
}
