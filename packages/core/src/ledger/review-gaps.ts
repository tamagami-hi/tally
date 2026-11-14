import { reviewStateOf } from "../records/reviews.ts";
import type { Config } from "../schema/config.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Review } from "../schema/reviews.ts";
import type { Gap } from "./gaps.ts";

export type ReviewSetting = NonNullable<Config["reviews"]>;

export interface Needing {
  milestone: string;
  task: string;
  track: string;
  state: "none" | "open";
  latest?: Review;
}

const START = 0;

const fromOf = (setting: ReviewSetting): number => {
  const at = Date.parse(setting.from ?? "");
  return Number.isNaN(at) ? START : at;
};

export function needingReview(ledger: Ledger, reviews: readonly Review[], setting: ReviewSetting | undefined): Needing[] {
  if (setting?.required !== true) return [];
  const from = fromOf(setting);
  return ledger.milestones.flatMap((milestone) => milestone.tasks.flatMap((task): Needing[] => {
    if (task.status !== "landed" || task.landedAt === undefined || Date.parse(task.landedAt) < from) return [];
    const { state, latest } = reviewStateOf(reviews, milestone.id, task.id);
    if (state === "clear") return [];
    return [{ milestone: milestone.id, task: task.id, track: task.track, state, ...(latest === undefined ? {} : { latest }) }];
  }));
}

const findings = (count: number): string => `${count} blocking finding${count === 1 ? "" : "s"}`;

export function needingText(one: Pick<Needing, "milestone" | "task" | "latest">): string {
  const name = `${one.milestone} '${one.task}'`;
  if (one.latest === undefined) return `${name} landed with no review: record one with review_record; if it needs none, an operator session records the verdict waived with the reason`;
  return `${name} has ${one.latest.id} with ${findings(one.latest.blocking)} and no later review: record the follow-up with review_record (follows: ${one.latest.id})`;
}

export function reviewGaps(ledger: Ledger, reviews: readonly Review[], setting: ReviewSetting | undefined): Gap[] {
  return needingReview(ledger, reviews, setting).map((one) => ({ milestone: one.milestone, task: one.task, track: one.track, text: needingText(one) }));
}

export function reviewNote(reviews: readonly Review[], setting: ReviewSetting | undefined, milestone: string, task: string): string | undefined {
  if (setting?.required !== true) return undefined;
  const { state, latest } = reviewStateOf(reviews, milestone, task);
  if (state === "clear") return undefined;
  const now = latest === undefined ? "has no review yet" : `has ${latest.id} with ${findings(latest.blocking)} and no later review`;
  return `this repository requires reviews, and ${milestone} '${task}' ${now}; once landed, ledger_check lists it until review_record clears it`;
}
