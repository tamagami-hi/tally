import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import type { Exact } from "../schema/kept.ts";

export const CYCLES_FILE = "cycles.json";
export const CYCLES_DIR = "cycles";
export const CLOSING_FILE = "closing.json";

const byOf = z.object({ track: z.string().min(1), agent: z.string().min(1) });

export const cycleSchema = z.looseObject({
  n: z.number().int().positive(),
  name: z.string().min(1).optional(),
  from: z.string().min(7),
  to: z.string().min(7),
  closedAt: z.string(),
  closedBy: byOf,
  said: z.string().min(1),
  decision: z.string().min(1).optional(),
  summary: z.string().min(1),
});

export const cyclesFileSchema = z.looseObject({
  schema: z.literal(1),
  current: z.number().int().positive(),
  cycles: z.array(cycleSchema).default([]),
});

export type CycleRecord = Exact<z.infer<typeof cycleSchema>>;
export type CyclesFile = Exact<z.infer<typeof cyclesFileSchema>>;

export const cyclesPath = (recordsDir: string): string => join(recordsDir, CYCLES_FILE);

export const cycleDir = (recordsDir: string, n: number): string => join(recordsDir, CYCLES_DIR, `cycle-${n}`);

export const closingPath = (recordsDir: string, n: number): string => join(cycleDir(recordsDir, n), CLOSING_FILE);

export const FIRST_CYCLE: CyclesFile = { schema: 1, current: 1, cycles: [] };

export async function readCycles(recordsDir: string): Promise<CyclesFile> {
  try {
    return await readJson(cyclesPath(recordsDir), cyclesFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { ...FIRST_CYCLE, cycles: [] };
    throw error;
  }
}

export const writeCycles = (recordsDir: string, file: CyclesFile): Promise<void> => withLock(cyclesPath(recordsDir), () => writeJsonAtomic(cyclesPath(recordsDir), cyclesFileSchema.parse(file)));
