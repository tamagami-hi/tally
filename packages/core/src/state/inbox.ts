import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readEntries, type Entry } from "../context/entries.ts";
import { applies, overlaps } from "../context/match.ts";
import { gitOut } from "../git/run.ts";
import { statePath } from "../land/paths.ts";
import { queueFile } from "../land/queue.ts";
import { RESULTS } from "../land/runner.ts";
import { isFor, readNotes } from "../records/notes.ts";
import { questionId, readQuestions } from "../records/questions.ts";
import { changedFiles } from "../status/overlaps.ts";
import type { Repo } from "../store/records.ts";
import { StateFile } from "./file.ts";
import { ledgerNewsFor, unrecordedNow, unrecordedText } from "./inbox-ledger.ts";
import type { Session } from "./sessions.ts";

export interface InboxItem {
  kind: "note" | "reply" | "answer" | "main" | "landing" | "run" | "context" | "ledger";
  at: string;
  text: string;
  from?: string;
}

const cursorSchema = z.object({ seenAt: z.string(), main: z.string().optional(), recent: z.array(z.string()).optional(), told: z.array(z.string()).optional(), checked: z.string().optional() });
type Cursor = z.infer<typeof cursorSchema>;

const SHORT_HASH = 7;
const SEPARATOR = "\u0001";
const GRACE_MS = 30_000;
const KEY_LENGTH = 16;

const keyOf = (item: InboxItem): string => createHash("sha256").update(`${item.kind}\n${item.at}\n${item.text}`).digest("hex").slice(0, KEY_LENGTH);

const before = (time: string | Date, ms: number): string => new Date(new Date(time).getTime() - ms).toISOString();

const cursorFile = (repo: Repo, session: Session): StateFile<Cursor> =>
  new StateFile(statePath(repo, "inbox", `${session.id}.json`), cursorSchema, () => ({ seenAt: session.openedAt }));

async function fromNotes(repo: Repo, session: Session, since: string): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  for (const note of (await readNotes(repo)).notes) {
    const mine = note.from.track === session.track;
    const forMe = isFor(note, session.track);
    if (!mine && forMe && note.at > since) items.push({ kind: "note", at: note.at, from: note.from.track, text: `${note.kind} from ${note.from.track} (${note.from.agent})${note.about?.record === undefined ? "" : ` about ${note.about.record}`}: ${note.text}` });
    for (const reply of note.replies) {
      if ((mine || forMe) && reply.from.track !== session.track && reply.at > since) items.push({ kind: "reply", at: reply.at, from: reply.from.track, text: `${reply.from.track} (${reply.from.agent}) replied to ${note.id}: ${reply.text}` });
    }
  }
  return items;
}

async function fromAnswers(repo: Repo, session: Session, since: string): Promise<InboxItem[]> {
  const answered = (await readQuestions(repo))?.answered ?? [];
  return answered.filter((row) => row.by === session.agent && (row.track === undefined || row.track === session.track) && row.answeredAt > since).map((row) => ({ kind: "answer" as const, at: row.answeredAt, text: `the operator answered ${questionId(row.row)}: ${row.decision}` }));
}

async function fromMain(repo: Repo, session: Session, seen: string | undefined, now: Date): Promise<InboxItem[]> {
  if (seen === undefined || session.track === repo.config.mainBranch) return [];
  const mine = new Set(await changedFiles(repo, session.track));
  if (mine.size === 0) return [];
  const log = await gitOut(repo.root, ["log", "--reverse", `--format=${SEPARATOR}%H %s`, "--name-only", `${seen}..${repo.config.mainBranch}`]);
  if (log === null) return [];
  const prefix = repo.config.records.commitPrefix;
  return log.split(SEPARATOR).filter((block) => block.trim() !== "").flatMap((block) => {
    const [head = "", ...files] = block.split("\n").filter((line) => line !== "");
    const subject = head.slice(head.indexOf(" ") + 1);
    const shared = files.filter((file) => mine.has(file));
    if (shared.length === 0 || subject.startsWith(prefix)) return [];
    return [{ kind: "main" as const, at: now.toISOString(), text: `main changed ${shared.join(", ")}, which this track has changed too (${head.slice(0, SHORT_HASH)} ${subject}); rebase soon` }];
  });
}

async function fromQueue(repo: Repo, session: Session, since: string): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  for (const ticket of (await queueFile(repo).read()).tickets.filter((one) => one.sessionId === session.id)) {
    if (ticket.state === "turn" && ticket.turn !== undefined && ticket.turn.startedAt > since) items.push({ kind: "landing", at: ticket.turn.startedAt, text: `ticket ${ticket.id} has its turn: run sh ${ticket.turn.script}` });
    if (ticket.endedAt === undefined || ticket.endedAt <= since) continue;
    if (ticket.state === "landed") items.push({ kind: "landing", at: ticket.endedAt, text: `ticket ${ticket.id} landed at ${ticket.landed?.head ?? ""}${ticket.note === undefined ? "" : `; ${ticket.note}`}` });
    if (ticket.state === "failed") items.push({ kind: "landing", at: ticket.endedAt, text: `ticket ${ticket.id} failed: ${ticket.problem ?? "no reason was kept"}` });
  }
  return items;
}

async function field(folder: string, name: string): Promise<string> {
  return (await readFile(join(folder, name), "utf8").catch(() => "")).trim();
}

const TAKEN = "taken";
const REFUSED = "refused";

const isUntold = (folder: string): Promise<boolean> => stat(join(folder, "untold")).then(() => true, () => false);

async function fromRuns(session: Session, since: string): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  for (const outcome of [TAKEN, REFUSED] as const) {
    const folder = join(session.worktree, RESULTS, outcome);
    for (const id of await readdir(folder).catch(() => [] as string[])) {
      const at = (await stat(join(folder, id))).mtime.toISOString();
      if (at <= since) continue;
      const kept = join(folder, id);
      if (outcome === TAKEN) items.push({ kind: "run", at, text: `your ${await field(kept, "kind")} run exited ${await field(kept, "exit")} and is recorded` });
      else if (await isUntold(kept)) items.push({ kind: "run", at, text: `a ${await field(kept, "kind")} run was set aside: ${await field(kept, "problem")}` });
    }
  }
  return items;
}

async function worksOn(repo: Repo, session: Session): Promise<(entry: Entry) => boolean> {
  const areas = repo.config.tracks.find((track) => track.name === session.track)?.paths;
  const files = areas === undefined ? await changedFiles(repo, session.track) : [];
  return (entry) => entry.paths.length === 0 || entry.paths.some((path) => (areas ?? []).some((area) => overlaps(path, area)) || files.some((file) => applies(path, file)));
}

async function fromContext(repo: Repo, session: Session, since: string): Promise<InboxItem[]> {
  const changed = (await readEntries(repo)).filter((entry) => entry.by.track !== session.track && (entry.at > since || (entry.retiredAt !== undefined && entry.retiredAt > since)));
  if (changed.length === 0) return [];
  const isMine = await worksOn(repo, session);
  return changed.filter(isMine).flatMap((entry) => {
    const added: InboxItem[] = entry.at > since ? [{ kind: "context", at: entry.at, from: entry.by.track, text: `${entry.by.track} (${entry.by.agent}) added the ${entry.kind} ${entry.id}: ${entry.title}` }] : [];
    const retired: InboxItem[] = entry.retiredAt !== undefined && entry.retiredAt > since ? [{ kind: "context", at: entry.retiredAt, text: `${entry.id} (${entry.title}) was retired: ${entry.retiredWhy ?? "no reason was kept"}` }] : [];
    return [...added, ...retired];
  });
}

async function gathered(repo: Repo, session: Session, cursor: Cursor, now: Date): Promise<InboxItem[]> {
  const { seenAt } = cursor;
  const found = await Promise.all([
    fromNotes(repo, session, seenAt),
    fromAnswers(repo, session, seenAt),
    fromMain(repo, session, cursor.main, now),
    fromQueue(repo, session, seenAt),
    fromRuns(session, seenAt),
    fromContext(repo, session, seenAt),
  ]);
  return found.flat().sort((a, b) => a.at.localeCompare(b.at));
}

const ledgerItem = (lines: readonly string[], now: Date): InboxItem[] => (lines.length === 0 ? [] : [{ kind: "ledger", at: now.toISOString(), text: unrecordedText(lines) }]);

export async function peekInbox(repo: Repo, session: Session, since: string = session.openedAt, now = new Date()): Promise<InboxItem[]> {
  const cursor = await cursorFile(repo, session).read();
  return [...(await gathered(repo, session, { ...cursor, seenAt: since }, now)), ...ledgerItem(await unrecordedNow(repo, session), now)];
}

export async function collectInbox(repo: Repo, session: Session, now = new Date()): Promise<InboxItem[]> {
  const main = (await gitOut(repo.root, ["rev-parse", repo.config.mainBranch])) ?? undefined;
  return cursorFile(repo, session).update(async (cursor) => {
    const delivered = new Set(cursor.recent ?? []);
    const isFirst = cursor.seenAt === session.openedAt && cursor.recent === undefined;
    const inWindow = await gathered(repo, session, { ...cursor, seenAt: isFirst ? cursor.seenAt : before(cursor.seenAt, GRACE_MS) }, now);
    const items = inWindow.filter((item) => !delivered.has(keyOf(item)));
    const kept = before(now, GRACE_MS);
    const recent = inWindow.filter((item) => item.at > kept).map(keyOf);
    const ledger = await ledgerNewsFor(repo, session, main, cursor);
    const value = { seenAt: now.toISOString(), told: ledger.told, checked: ledger.checked, ...(main === undefined ? {} : { main }), ...(recent.length === 0 ? {} : { recent }) };
    return { value, result: [...items, ...ledgerItem(ledger.lines, now)] };
  });
}
