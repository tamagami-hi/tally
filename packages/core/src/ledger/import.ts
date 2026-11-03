import { z } from "zod";
import type { Stage } from "../schema/config.ts";
import type { Ledger, Milestone, Task } from "../schema/ledger.ts";

const boardItemSchema = z.object({
  id: z.string(),
  track: z.string(),
  commit: z.string().nullable().optional(),
  also: z.array(z.string()).optional(),
  waits: z.string().optional(),
});

const boardMilestoneSchema = z.object({
  id: z.string(),
  stage: z.string(),
  name: z.string(),
  track: z.string(),
  weight: z.number().int().positive(),
  built: z.string().optional(),
  waits: z.string().optional(),
  items: z.array(boardItemSchema).optional(),
});

export const boardSchema = z.object({
  baseline: z.string(),
  stage_weights: z.record(z.string(), z.number().int().positive()),
  milestones: z.array(boardMilestoneSchema),
  other_commits: z.record(z.string(), z.string()).optional(),
});

export type Board = z.infer<typeof boardSchema>;

function taskOf(item: z.infer<typeof boardItemSchema>): Task {
  const commit = item.commit ?? undefined;
  return {
    id: item.id,
    track: item.track,
    status: commit === undefined ? "planned" : "landed",
    ...(commit === undefined ? {} : { commit }),
    also: item.also ?? [],
    ...(item.waits === undefined ? {} : { waits: item.waits }),
  };
}

function milestoneOf(entry: z.infer<typeof boardMilestoneSchema>): Milestone {
  return {
    id: entry.id,
    stage: entry.stage,
    name: entry.name,
    track: entry.track,
    weight: entry.weight,
    ...(entry.built === undefined ? {} : { built: entry.built }),
    ...(entry.waits === undefined ? {} : { waits: entry.waits }),
    tasks: (entry.items ?? []).map(taskOf),
  };
}

export function fromBoard(input: unknown, stageNames: Record<string, string>): { ledger: Ledger; stages: Stage[] } {
  const board = boardSchema.parse(input);
  const ledger: Ledger = {
    schema: 1,
    baseline: board.baseline,
    milestones: board.milestones.map(milestoneOf),
    other: Object.entries(board.other_commits ?? {}).map(([commit, note]) => ({ commit, note })),
  };
  const stages = Object.entries(board.stage_weights).map(([id, weight]) => ({ id, name: stageNames[id] ?? "", weight }));
  return { ledger, stages };
}
