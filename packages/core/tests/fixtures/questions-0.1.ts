import { z } from "zod";

export const questionSchema = z.object({
  row: z.number().int().positive(),
  group: z.string().min(1),
  question: z.string().min(1),
  meanwhile: z.string(),
  asked: z.string().optional(),
  by: z.string().optional(),
});

export const answeredSchema = questionSchema.extend({ answeredAt: z.string(), decision: z.string() });
export const answeredRowsSchema = z.array(answeredSchema);

export const questionsFileSchema = z.object({
  schema: z.literal(1),
  nextRow: z.number().int().positive(),
  open: z.array(questionSchema).default([]),
  answered: z.array(answeredSchema).default([]),
});
