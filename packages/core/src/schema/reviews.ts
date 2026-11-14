import { z } from "zod";

export const reviewVerdicts = ["land", "fix", "stop", "waived"] as const;
export const reviewStates = ["none", "clear", "open"] as const;

export const keptFileSchema = z.object({ path: z.string(), sha256: z.string().length(64), bytes: z.number().int().nonnegative() });

export const reviewSchema = z.object({
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

export const reviewsFileSchema = z.object({
  schema: z.literal(1),
  nextId: z.number().int().positive(),
  reviews: z.array(reviewSchema).default([]),
});

export type Review = z.infer<typeof reviewSchema>;
export type ReviewVerdict = (typeof reviewVerdicts)[number];
export type ReviewState = (typeof reviewStates)[number];
export type ReviewsFile = z.infer<typeof reviewsFileSchema>;
export type KeptFile = z.infer<typeof keptFileSchema>;
