import { z } from "zod";
import { whoSchema, type Exact } from "./kept.ts";

export const PHASES_FILE = "phases.json";

export const phaseSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  weight: z.number().int().positive().optional(),
  goal: z.string().min(1).optional(),
  decision: z.string().min(1).optional(),
  openedAt: z.string().optional(),
  openedBy: whoSchema.optional(),
  closedAt: z.string().optional(),
  closedBy: whoSchema.optional(),
  summary: z.string().optional(),
  commit: z.string().optional(),
});

export const phasesFileSchema = z.looseObject({
  schema: z.literal(1),
  phases: z.array(phaseSchema).default([]),
});

export type PhaseRecord = Exact<z.infer<typeof phaseSchema>>;
export type PhasesFile = Exact<z.infer<typeof phasesFileSchema>>;
