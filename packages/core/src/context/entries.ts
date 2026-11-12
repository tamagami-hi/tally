import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { commitRecords } from "../records/commit.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { segmentsOf } from "./match.ts";

export const ENTRY_KINDS = ["rule", "convention", "area", "interface", "howto", "finding"] as const;
export const MAX_TITLE = 120;
export const MAX_TEXT = 2000;
export const CONTEXT_DIR = "context";

export type EntryKind = (typeof ENTRY_KINDS)[number];
export type Author = Pick<Session, "track" | "agent">;

const OPERATOR_KIND: EntryKind = "rule";
const ENTRY_ID = new RegExp(`^(${ENTRY_KINDS.join("|")})-[1-9]\\d*$`);
const LOCK_NAME = "entries";
const OUTSIDE = "..";

export const authorSchema = z.object({ track: z.string().min(1), agent: z.string().min(1) });

export const entrySchema = z.object({
  id: z.string().regex(ENTRY_ID),
  kind: z.enum(ENTRY_KINDS),
  title: z.string().min(1).max(MAX_TITLE),
  text: z.string().min(1).max(MAX_TEXT),
  paths: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  refs: z.array(z.string().min(1)).default([]),
  by: authorSchema,
  at: z.string(),
  replaces: z.string().optional(),
  retiredAt: z.string().optional(),
  retiredWhy: z.string().optional(),
});

export const kindFileSchema = z.object({
  schema: z.literal(1),
  kind: z.enum(ENTRY_KINDS),
  nextNumber: z.number().int().positive(),
  entries: z.array(entrySchema).default([]),
});

export type Entry = z.infer<typeof entrySchema>;
export type KindFile = z.infer<typeof kindFileSchema>;

export interface EntryInput {
  kind: EntryKind;
  title: string;
  text: string;
  paths?: readonly string[];
  tags?: readonly string[];
  refs?: readonly string[];
  replaces?: string;
}

export const contextDir = (repo: Repo): string => join(repo.recordsDir, CONTEXT_DIR);

export const kindPath = (repo: Repo, kind: EntryKind): string => join(contextDir(repo), `${kind}.json`);

export const authorOf = (session: Author): Author => ({ track: session.track, agent: session.agent });

export async function readKind(repo: Repo, kind: EntryKind): Promise<KindFile> {
  try {
    return await readJson(kindPath(repo, kind), kindFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, kind, nextNumber: 1, entries: [] };
    throw error;
  }
}

export async function readEntries(repo: Repo, kinds: readonly EntryKind[] = ENTRY_KINDS): Promise<Entry[]> {
  const files = await Promise.all(kinds.map((kind) => readKind(repo, kind)));
  return files.flatMap((file) => file.entries);
}

export function kindOfId(id: string): EntryKind {
  const kind = ENTRY_ID.exec(id)?.[1];
  if (kind === undefined) throw new TallyError(`'${id}' is not an entry's id; an id is a kind and a number, such as finding-3 (kinds: ${ENTRY_KINDS.join(", ")})`);
  return kind as EntryKind;
}

function mustMayWrite(repo: Repo, session: Author, kind: EntryKind): void {
  if (kind === OPERATOR_KIND && !isOperator(repo, session)) throw new TallyError("only an operator session writes a rule; a track that wants one asks a question with question_add");
}

function bounded(what: string, given: string, most: number, hint = ""): string {
  const value = given.trim();
  if (value === "") throw new TallyError(`an entry needs a ${what}`);
  if (value.length > most) throw new TallyError(`an entry's ${what} holds at most ${most} characters; this one has ${value.length}${hint}`);
  return value;
}

function fromRoot(path: string): string {
  const segments = segmentsOf(path.trim());
  if (path.trim().startsWith("/") || segments.includes(OUTSIDE) || segments.length === 0) throw new TallyError(`an entry's path is a file, a folder or a glob from the repository's root; '${path}' is not`);
  return segments.join("/");
}

const named = (values: readonly string[] | undefined): string[] => [...new Set((values ?? []).map((value) => value.trim()).filter((value) => value !== ""))];

function retiredIn(file: KindFile, id: string, at: string, why: string): { file: KindFile; entry: Entry } {
  const found = file.entries.find((entry) => entry.id === id);
  if (found === undefined) throw new TallyError(`no entry ${id}; context_get lists the entries`);
  if (found.retiredAt !== undefined) throw new TallyError(`${id} was retired at ${found.retiredAt}${found.retiredWhy === undefined ? "" : ` (${found.retiredWhy})`}; nothing was changed`);
  const entry: Entry = { ...found, retiredAt: at, retiredWhy: why };
  return { file: { ...file, entries: file.entries.map((each) => (each.id === id ? entry : each)) }, entry };
}

const locked = <T>(repo: Repo, body: () => Promise<T>): Promise<T> => withLock(join(contextDir(repo), LOCK_NAME), body);

const write = (repo: Repo, file: KindFile): Promise<void> => writeJsonAtomic(kindPath(repo, file.kind), kindFileSchema.parse(file));

export async function putEntry(repo: Repo, session: Author, input: EntryInput, now = new Date()): Promise<{ entry: Entry; retired?: Entry; commit: string | null }> {
  const { kind, replaces } = input;
  const replacedKind = replaces === undefined ? undefined : kindOfId(replaces);
  mustMayWrite(repo, session, kind);
  if (replacedKind !== undefined) mustMayWrite(repo, session, replacedKind);
  const fields = {
    title: bounded("title", input.title, MAX_TITLE),
    text: bounded("text", input.text, MAX_TEXT, ". A longer subject is several entries"),
    paths: [...new Set((input.paths ?? []).map(fromRoot))],
    tags: named(input.tags),
    refs: named(input.refs),
  };
  const at = now.toISOString();
  const written = await locked(repo, async () => {
    const file = await readKind(repo, kind);
    const entry: Entry = { id: `${kind}-${file.nextNumber}`, kind, ...fields, by: authorOf(session), at, ...(replaces === undefined ? {} : { replaces }) };
    const added: KindFile = { ...file, nextNumber: file.nextNumber + 1, entries: [...file.entries, entry] };
    if (replaces === undefined || replacedKind === undefined) {
      await write(repo, added);
      return { entry };
    }
    const retiring = retiredIn(replacedKind === kind ? added : await readKind(repo, replacedKind), replaces, at, `replaced by ${entry.id}`);
    if (replacedKind !== kind) await write(repo, added);
    await write(repo, retiring.file);
    return { entry, retired: retiring.entry };
  });
  const commit = await commitRecords(repo, `${written.entry.id} added to the context by ${session.agent}${replaces === undefined ? "" : `, replacing ${replaces}`}`);
  return { ...written, commit };
}

export async function retireEntry(repo: Repo, session: Author, id: string, why: string, now = new Date()): Promise<{ entry: Entry; commit: string | null }> {
  const kind = kindOfId(id);
  mustMayWrite(repo, session, kind);
  const reason = why.trim();
  if (reason === "") throw new TallyError("retiring an entry needs the reason");
  const entry = await locked(repo, async () => {
    const retiring = retiredIn(await readKind(repo, kind), id, now.toISOString(), reason);
    await write(repo, retiring.file);
    return retiring.entry;
  });
  const commit = await commitRecords(repo, `${id} retired from the context by ${session.agent}`);
  return { entry, commit };
}
