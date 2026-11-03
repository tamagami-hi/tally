import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import type { Session } from "../state/sessions.ts";
import { commitRecords } from "./commit.ts";

export const MAX_HANDOFF_LINES = 60;

export const handoffNoteSchema = z.object({
  task: z.string().optional(),
  from: z.string().min(1),
  track: z.string().min(1),
  at: z.string(),
  lines: z.array(z.string()).max(MAX_HANDOFF_LINES),
});

export const handoffSchema = z.object({
  schema: z.literal(1),
  track: z.string().min(1),
  current: handoffNoteSchema.optional(),
  history: z.array(handoffNoteSchema).default([]),
});

export type HandoffNote = z.infer<typeof handoffNoteSchema>;
export type Handoff = z.infer<typeof handoffSchema>;

export const safeName = (id: string): string => id.replaceAll(/[^A-Za-z0-9._-]/g, "_");

export const handoffPath = (repo: Repo, track: string): string => join(repo.recordsDir, "handoffs", `${safeName(track)}.json`);

export async function readHandoff(repo: Repo, track: string): Promise<Handoff> {
  try {
    return await readJson(handoffPath(repo, track), handoffSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, track, history: [] };
    throw error;
  }
}

export interface HandoffInput {
  task?: string;
  lines: readonly string[];
}

export async function writeHandoff(repo: Repo, session: Session, input: HandoffInput, now = new Date()): Promise<{ handoff: Handoff; commit: string | null }> {
  if (input.lines.length === 0) throw new TallyError("a hand-off needs at least one line");
  if (input.lines.length > MAX_HANDOFF_LINES) throw new TallyError(`a hand-off holds at most ${MAX_HANDOFF_LINES} lines; this one has ${input.lines.length}`);
  const path = handoffPath(repo, session.track);
  const handoff = await withLock(path, async () => {
    const previous = await readHandoff(repo, session.track);
    const note: HandoffNote = { ...(input.task === undefined ? {} : { task: input.task }), from: session.agent, track: session.track, at: now.toISOString(), lines: [...input.lines] };
    const next: Handoff = { schema: 1, track: session.track, current: note, history: previous.current === undefined ? previous.history : [...previous.history, previous.current] };
    await writeJsonAtomic(path, next);
    return next;
  });
  const commit = await commitRecords(repo, `${session.track}: hand-off from ${session.agent}`);
  return { handoff, commit };
}
