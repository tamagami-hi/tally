import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { PHASES_FILE, phasesFileSchema, type PhasesFile } from "../schema/phases.ts";
import { readJson, tolerated, writeJsonAtomic, type Tolerated } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { refuseClosedFolder } from "../cycles/file.ts";

export const phasesPath = (recordsDir: string): string => join(recordsDir, PHASES_FILE);

export async function readPhases(recordsDir: string): Promise<PhasesFile> {
  try {
    return await readJson(phasesPath(recordsDir), phasesFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, phases: [] };
    throw error;
  }
}

export const readablePhases = (recordsDir: string): Promise<Tolerated<PhasesFile>> => tolerated(readPhases(recordsDir), { schema: 1, phases: [] });

export async function changePhases<R>(recordsDir: string, change: (file: PhasesFile) => Promise<{ file: PhasesFile; result: R }> | { file: PhasesFile; result: R }): Promise<R> {
  refuseClosedFolder(recordsDir);
  const path = phasesPath(recordsDir);
  return withLock(path, async () => {
    const { file, result } = await change(await readPhases(recordsDir));
    await writeJsonAtomic(path, phasesFileSchema.parse(file));
    return result;
  });
}
