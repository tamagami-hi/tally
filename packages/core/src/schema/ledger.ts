import { z } from "zod";

export const taskStatuses = ["planned", "claimed", "landed"] as const;

export const taskSchema = z
  .object({
    id: z.string().min(1),
    track: z.string().min(1),
    status: z.enum(taskStatuses),
    commit: z.string().min(7).optional(),
    also: z.array(z.string().min(7)).default([]),
    waits: z.string().optional(),
    claimedBy: z.string().optional(),
    since: z.string().optional(),
  })
  .superRefine((task, context) => {
    if (task.status === "landed" && task.commit === undefined) {
      context.addIssue({ code: "custom", message: `task ${task.id} is landed but names no commit` });
    }
    if (task.status !== "landed" && task.commit !== undefined) {
      context.addIssue({ code: "custom", message: `task ${task.id} names a commit but is not landed` });
    }
  });

export const milestoneSchema = z.object({
  id: z.string().min(1),
  stage: z.string().min(1),
  group: z.string().optional(),
  name: z.string(),
  track: z.string().min(1),
  weight: z.number().int().positive(),
  built: z.string().optional(),
  waits: z.string().optional(),
  tasks: z.array(taskSchema).default([]),
});

export const otherCommitSchema = z.object({ commit: z.string().min(7), note: z.string() });

export const ledgerSchema = z.object({
  schema: z.literal(1),
  baseline: z.string().min(7),
  milestones: z.array(milestoneSchema).default([]),
  other: z.array(otherCommitSchema).default([]),
});

export type Task = z.infer<typeof taskSchema>;
export type TaskStatus = (typeof taskStatuses)[number];
export type Milestone = z.infer<typeof milestoneSchema>;
export type OtherCommit = z.infer<typeof otherCommitSchema>;
export type Ledger = z.infer<typeof ledgerSchema>;
