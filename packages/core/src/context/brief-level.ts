import type { HandoffNote } from "../records/handoffs.ts";
import type { CheckoutState } from "../land/operator.ts";
import type { ToMark } from "../records/cited.ts";
import type { Confirming } from "../records/decision-record.ts";
import type { Waiting } from "../records/waiting.ts";
import type { Entry, EntryKind } from "./entries.ts";
import type { Project } from "./project.ts";

export const briefLevels = ["full", "work", "land"] as const;
export type BriefLevel = (typeof briefLevels)[number];

export interface BriefTask {
  milestone: string;
  id: string;
  waits?: string;
  claimedBy?: string;
  brief?: string;
  paths?: string[];
}

export interface Working {
  track: string;
  agent: string;
  since: string;
  task?: string;
}

export interface BriefRule {
  id: string;
  section?: string;
  title: string;
  text?: string;
}

export interface Tailoring {
  id: string;
  title: string;
  tailor: string;
}

export interface Rulebook {
  rules: number;
  changedAt: string | null;
}

export interface BriefCycle {
  n: number;
  complete?: boolean;
  ask?: string;
}

export interface FullBrief {
  level: BriefLevel;
  project: Project;
  rules: BriefRule[];
  rulebook: Rulebook;
  tailoring?: Tailoring[];
  recordsWaiting?: Waiting;
  checkout?: CheckoutState;
  decisions?: Confirming;
  decisionsToMark?: ToMark[];
  cycle: BriefCycle;
  track: { name: string; tasks: BriefTask[]; handoff: HandoffNote | null };
  entries: { id: string; kind: EntryKind; title: string }[];
  working: Working[];
  openQuestions: number;
  missing: string[];
}

export interface Brief {
  level: BriefLevel;
  project?: Project | { name: string; purpose: string };
  rules?: BriefRule[];
  rulebook: Rulebook;
  tailoring?: Tailoring[];
  recordsWaiting?: Waiting;
  checkout?: CheckoutState;
  decisions?: Confirming;
  decisionsToMark?: ToMark[];
  cycle: BriefCycle;
  track: { name: string; tasks: BriefTask[]; handoff?: HandoffNote | null };
  entries?: { id: string; kind: EntryKind; title: string }[];
  working: Working[];
  openQuestions?: number;
  missing?: string[];
}

const latest = (times: readonly string[]): string | null => times.reduce<string | null>((newest, time) => (newest === null || Date.parse(time) > Date.parse(newest) ? time : newest), null);

export function rulebookOf(entries: readonly Entry[], inForce: number): Rulebook {
  const rules = entries.filter((entry) => entry.kind === "rule");
  return { rules: inForce, changedAt: latest(rules.flatMap((rule) => [rule.at, ...(rule.retiredAt === undefined ? [] : [rule.retiredAt])])) };
}

const titled = ({ text: _text, ...rule }: BriefRule): BriefRule => rule;

export const landing = ({ brief: _brief, paths: _paths, ...task }: BriefTask): BriefTask => task;

export function atLevel(full: FullBrief, level: BriefLevel, name: string): Brief {
  if (level === "full") return full;
  const { project, rules, tailoring: _tailoring, track, entries, missing: _missing, openQuestions, ...kept } = full;
  if (level === "work") return { ...kept, level, project: { name, purpose: project.purpose }, rules: rules.map(titled), track, entries, openQuestions };
  return { ...kept, level, track: { name: track.name, tasks: track.tasks.map(landing) } };
}
