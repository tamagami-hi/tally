import { z } from "zod";
import { statePath } from "../land/paths.ts";
import { safeName } from "../records/handoffs.ts";
import type { Repo } from "../store/records.ts";
import { StateFile } from "./file.ts";

const restSchema = z.object({ endedAt: z.string().optional(), told: z.string().optional() });

export type Rest = z.infer<typeof restSchema>;

const restFile = (repo: Pick<Repo, "stateDir">, track: string): StateFile<Rest> => new StateFile(statePath(repo, "tracks", `${safeName(track)}.json`), restSchema, () => ({}));

export const readRest = (repo: Pick<Repo, "stateDir">, track: string): Promise<Rest> => restFile(repo, track).read();

export const stampRest = (repo: Pick<Repo, "stateDir">, track: string, now: Date): Promise<void> => restFile(repo, track).update((rest) => ({ value: { ...rest, endedAt: now.toISOString() }, result: undefined }));

export const markTold = (repo: Pick<Repo, "stateDir">, track: string, told: string): Promise<void> => restFile(repo, track).update((rest) => ({ value: { ...rest, told }, result: undefined }));
