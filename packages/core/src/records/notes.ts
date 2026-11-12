import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { commitRecords } from "./commit.ts";

export const noteKinds = ["heads-up", "request", "answer", "finding"] as const;
export const MAX_NOTE = 600;

const writerSchema = z.object({ track: z.string().min(1), agent: z.string().min(1) });

export const noteSchema = z.object({
  id: z.string().min(1),
  from: writerSchema,
  to: z.union([z.literal("all"), z.array(z.string().min(1)).min(1)]),
  kind: z.enum(noteKinds),
  text: z.string().min(1).max(MAX_NOTE),
  about: z.object({ paths: z.array(z.string()).optional(), task: z.string().optional() }).optional(),
  at: z.string(),
  replies: z.array(z.object({ from: writerSchema, text: z.string().min(1).max(MAX_NOTE), at: z.string() })).default([]),
  doneAt: z.string().optional(),
});

const notesFileSchema = z.object({ schema: z.literal(1), nextNumber: z.number().int().positive(), notes: z.array(noteSchema) });

export type Note = z.infer<typeof noteSchema>;
type NotesFile = z.infer<typeof notesFileSchema>;

export interface NoteInput {
  to: "all" | readonly string[];
  kind: Note["kind"];
  text: string;
  about?: { paths?: string[]; task?: string };
}

export interface NoteFilter {
  track?: string;
  state?: "open" | "done" | "all";
  since?: string;
  limit?: number;
}

export const notesPath = (repo: Repo): string => join(repo.recordsDir, "context", "notes.json");

export async function readNotes(repo: Repo): Promise<NotesFile> {
  try {
    return await readJson(notesPath(repo), notesFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, nextNumber: 1, notes: [] };
    throw error;
  }
}

async function change<R>(repo: Repo, message: (result: R) => string, body: (file: NotesFile) => { file: NotesFile; result: R }): Promise<R> {
  const result = await withLock(notesPath(repo), async () => {
    const changed = body(await readNotes(repo));
    await writeJsonAtomic(notesPath(repo), notesFileSchema.parse(changed.file));
    return changed.result;
  });
  await commitRecords(repo, message(result));
  return result;
}

function checkedText(text: string): string {
  if (text.length > MAX_NOTE) throw new TallyError(`a note is at most ${MAX_NOTE} characters; this one has ${text.length}`);
  if (text.trim() === "") throw new TallyError("a note needs some text");
  return text;
}

function checkedReaders(repo: Repo, to: NoteInput["to"]): Note["to"] {
  if (to === "all") return "all";
  const known = [repo.config.mainBranch, ...repo.config.tracks.map((track) => track.name)];
  const unknown = to.find((name) => !known.includes(name));
  if (unknown !== undefined) throw new TallyError(`no track '${unknown}'; a note goes to all, ${known.slice(0, -1).join(", ")}${known.length > 1 ? " or " : ""}${known.at(-1) ?? ""}`);
  if (to.length === 0) throw new TallyError("a note goes to all or to at least one track");
  return [...to];
}

const writer = (session: Session): Note["from"] => ({ track: session.track, agent: session.agent });

export const isFor = (note: Note, track: string): boolean => note.to === "all" || note.to.includes(track);

function found(file: NotesFile, id: string): Note {
  const note = file.notes.find((one) => one.id === id);
  if (note === undefined) throw new TallyError(`no note ${id}`);
  return note;
}

const replaced = (file: NotesFile, next: Note): NotesFile => ({ ...file, notes: file.notes.map((note) => (note.id === next.id ? next : note)) });

export async function postNote(repo: Repo, session: Session, input: NoteInput, now = new Date()): Promise<Note> {
  const text = checkedText(input.text);
  const to = checkedReaders(repo, input.to);
  return change(repo, (note) => `${note.id} from ${note.from.track}`, (file) => {
    const note: Note = { id: `note-${file.nextNumber}`, from: writer(session), to, kind: input.kind, text, ...(input.about === undefined ? {} : { about: input.about }), at: now.toISOString(), replies: [] };
    return { file: { ...file, nextNumber: file.nextNumber + 1, notes: [...file.notes, note] }, result: note };
  });
}

export async function replyNote(repo: Repo, session: Session, id: string, text: string, now = new Date()): Promise<Note> {
  const reply = { from: writer(session), text: checkedText(text), at: now.toISOString() };
  return change(repo, (note) => `a reply to ${note.id} from ${session.track}`, (file) => {
    const note = found(file, id);
    const next: Note = { ...note, replies: [...note.replies, reply] };
    return { file: replaced(file, next), result: next };
  });
}

export async function doneNote(repo: Repo, session: Session, id: string, now = new Date()): Promise<Note> {
  return change(repo, (note) => `${note.id} is done`, (file) => {
    const note = found(file, id);
    const involved = note.from.track === session.track || isFor(note, session.track) || isOperator(repo, session);
    if (!involved) throw new TallyError(`${note.id} is between ${note.from.track} and ${note.to === "all" ? "all" : note.to.join(", ")}; ${session.track} cannot close it`);
    const next: Note = { ...note, doneAt: note.doneAt ?? now.toISOString() };
    return { file: replaced(file, next), result: next };
  });
}

const touchedSince = (note: Note, since: string): boolean => note.at >= since || (note.doneAt !== undefined && note.doneAt >= since) || note.replies.some((reply) => reply.at >= since);

export async function listNotes(repo: Repo, filter: NoteFilter = {}): Promise<Note[]> {
  const { track, state = "open", since, limit } = filter;
  const kept = (await readNotes(repo)).notes.filter((note) => {
    if (track !== undefined && !isFor(note, track)) return false;
    if (state === "open" && note.doneAt !== undefined) return false;
    if (state === "done" && note.doneAt === undefined) return false;
    return since === undefined || touchedSince(note, since);
  });
  return limit === undefined ? kept : kept.slice(-limit);
}
