import { z } from "zod";

export const PHASES_FILE = "phases.json";

export const phaseSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  weight: z.number().int().positive().optional(),
  goal: z.string().min(1).optional(),
  decision: z.string().min(1).optional(),
  openedAt: z.string().optional(),
  openedBy: z.object({ track: z.string().min(1), agent: z.string().min(1) }).optional(),
  closedAt: z.string().optional(),
  closedBy: z.object({ track: z.string().min(1), agent: z.string().min(1) }).optional(),
  summary: z.string().optional(),
  commit: z.string().optional(),
});

export const phasesFileSchema = z.looseObject({
  schema: z.literal(1),
  phases: z.array(phaseSchema).default([]),
});

export type PhaseRecord = z.infer<typeof phaseSchema>;
export type PhasesFile = z.infer<typeof phasesFileSchema>;
