import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { PHASES_FILE, phasesFileSchema, type PhasesFile } from "../schema/phases.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";

export const phasesPath = (recordsDir: string): string => join(recordsDir, PHASES_FILE);

export async function readPhases(recordsDir: string): Promise<PhasesFile> {
  try {
    return await readJson(phasesPath(recordsDir), phasesFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, phases: [] };
    throw error;
  }
}

export function changePhases<R>(recordsDir: string, change: (file: PhasesFile) => Promise<{ file: PhasesFile; result: R }> | { file: PhasesFile; result: R }): Promise<R> {
  const path = phasesPath(recordsDir);
  return withLock(path, async () => {
    const { file, result } = await change(await readPhases(recordsDir));
    await writeJsonAtomic(path, phasesFileSchema.parse(file));
    return result;
  });
}
