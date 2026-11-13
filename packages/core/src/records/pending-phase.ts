import { z } from "zod";
import { statePath } from "../land/paths.ts";
import { StateFile } from "../state/file.ts";
import type { Repo } from "../store/records.ts";

const pendingSchema = z.object({ pending: z.object({ phase: z.string().min(1), summary: z.string() }).optional() });

const pendingFile = (repo: Pick<Repo, "stateDir">): StateFile<z.infer<typeof pendingSchema>> => new StateFile(statePath(repo, "phase-commit.json"), pendingSchema, () => ({}));

export async function readPendingPhase(repo: Pick<Repo, "stateDir">): Promise<{ phase: string; summary: string } | undefined> {
  return (await pendingFile(repo).read()).pending;
}

export const markPendingPhase = (repo: Pick<Repo, "stateDir">, phase: string, summary: string): Promise<void> => pendingFile(repo).update(() => ({ value: { pending: { phase, summary } }, result: undefined }));

export const clearPendingPhase = (repo: Pick<Repo, "stateDir">): Promise<void> => pendingFile(repo).update(() => ({ value: {}, result: undefined }));
