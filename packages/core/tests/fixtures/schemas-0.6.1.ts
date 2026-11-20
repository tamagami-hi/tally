import { z } from "zod";

const taskStatuses = ["planned", "claimed", "landed"] as const;

const deliverableSchema = z.object({
  id: z.string().min(1),
  what: z.string().min(1),
  paths: z.array(z.string().min(1)).optional(),
});

const waitOnSchema = z.object({
  task: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  what: z.string(),
});

const parkedSchema = z.object({
  why: z.string().min(1),
  decision: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
});

const deferredSchema = z.object({
  what: z.string().min(1),
  to: z.string().min(1).optional(),
  parked: parkedSchema.optional(),
});

const taskSchema = z
  .object({
    id: z.string().min(1),
    track: z.string().min(1),
    status: z.enum(taskStatuses),
    commit: z.string().min(7).optional(),
    also: z.array(z.string().min(7)).default([]),
    waits: z.string().optional(),
    claimedBy: z.string().optional(),
    since: z.string().optional(),
    brief: z.string().optional(),
    paths: z.array(z.string().min(1)).optional(),
    covers: z.array(z.string().min(1)).optional(),
    waitsOn: z.array(waitOnSchema).optional(),
    deferred: z.array(deferredSchema).optional(),
    landedAt: z.string().optional(),
  })
  .superRefine((task, context) => {
    if (task.status === "landed" && task.commit === undefined) {
      context.addIssue({ code: "custom", message: `task ${task.id} is landed but names no commit` });
    }
    if (task.status !== "landed" && task.commit !== undefined) {
      context.addIssue({ code: "custom", message: `task ${task.id} names a commit but is not landed` });
    }
  });

const milestoneSchema = z.object({
  id: z.string().min(1),
  stage: z.string().min(1),
  group: z.string().optional(),
  name: z.string(),
  track: z.string().min(1),
  weight: z.number().int().positive(),
  built: z.string().optional(),
  waits: z.string().optional(),
  delivers: z.array(deliverableSchema).optional(),
  tasks: z.array(taskSchema).default([]),
});

const otherCommitSchema = z.object({ commit: z.string().min(7), note: z.string() });

const ledgerSchema = z.object({
  schema: z.literal(1),
  baseline: z.string().min(7),
  milestones: z.array(milestoneSchema).default([]),
  other: z.array(otherCommitSchema).default([]),
});



const openedTrackSchema = z.object({
  name: z.string().min(1),
  branch: z.string().min(1),
  worktree: z.string().min(1),
  parent: z.string().min(1).optional(),
  purpose: z.string().min(1),
  paths: z.array(z.string().min(1)).optional(),
  openedBy: z.object({ track: z.string().min(1), agent: z.string().min(1) }),
  openedAt: z.string(),
  closedAt: z.string().optional(),
  closedBy: z.object({ track: z.string().min(1), agent: z.string().min(1) }).optional(),
  closedWhy: z.string().optional(),
});

const tracksFileSchema = z.object({
  schema: z.literal(1),
  tracks: z.array(openedTrackSchema).default([]),
});


const keptFileSchema = z.object({ path: z.string(), sha256: z.string().length(64), bytes: z.number().int().nonnegative() });


const reviewVerdicts = ["land", "fix", "stop", "waived"] as const;
const reviewStates = ["none", "clear", "open"] as const;

const reviewSchema = z.object({
  id: z.string().min(1),
  milestone: z.string().min(1),
  task: z.string().min(1),
  track: z.string().min(1),
  commit: z.string().min(7),
  reviewer: z.string().min(1),
  verdict: z.enum(reviewVerdicts),
  blocking: z.number().int().nonnegative(),
  findings: z.record(z.string(), z.number().int().nonnegative()).optional(),
  summary: z.string().min(1),
  follows: z.string().min(1).optional(),
  report: keptFileSchema.optional(),
  by: z.object({ track: z.string().min(1), agent: z.string().min(1) }),
  at: z.string(),
});

const reviewsFileSchema = z.object({
  schema: z.literal(1),
  nextId: z.number().int().positive(),
  reviews: z.array(reviewSchema).default([]),
});


export const SCHEMAS_061 = { ledger: ledgerSchema, tracks: tracksFileSchema, reviews: reviewsFileSchema };
