import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { worktreeOf } from "../land/paths.ts";
import { RESULTS } from "../land/runner.ts";
import { listClaims } from "../state/claims.ts";
import { listSessions, markSeen, type Session } from "../state/sessions.ts";
import { LEDGER_FILE, Records, type Repo } from "../store/records.ts";
import { evidenceKinds, recordEvidence, type EvidenceKind, type RunRecord } from "./evidence.ts";
import { MAX_NOTE, noteFrom, readNotes } from "./notes.ts";
import { TALLY } from "./tell.ts";

export interface Taken {
  id: string;
  worktree: string;
  record?: RunRecord;
  notice?: string;
  problem?: string;
}

interface Place {
  worktree: string;
  track: string;
  branch: string;
}

const TAKEN = "taken";
const REFUSED = "refused";
const PROBLEM = "problem";
const PARTIAL = ".tmp";
const CLAIMED = ".taking";
const ABANDONED_MS = 60_000;
const RUNNER_AGENT = "runner";

export const MOST_RETRIED = 20;

const placesOf = (repo: Repo): Place[] => [
  { worktree: repo.root, track: repo.config.mainBranch, branch: repo.config.mainBranch },
  ...repo.config.tracks.map((track) => ({ worktree: worktreeOf(repo, track), track: track.name, branch: track.branch })),
];

async function waiting(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.endsWith(PARTIAL) && !entry.name.endsWith(CLAIMED) && entry.name !== TAKEN && entry.name !== REFUSED).map((entry) => entry.name).sort();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function field(folder: string, name: string): Promise<string> {
  try {
    return (await readFile(join(folder, name), "utf8")).replace(/\n$/, "");
  } catch {
    throw new TallyError(`the result has no '${name}'`);
  }
}

async function ranOn(folder: string): Promise<{ head?: string; dirty?: boolean }> {
  const head = await field(folder, "head").catch(() => "");
  if (head === "") return {};
  const dirty = await field(folder, "dirty").catch(() => "");
  return dirty === "true" || dirty === "false" ? { head, dirty: dirty === "true" } : { head };
}

const openAt = (place: Place, sessions: readonly Session[]): Session | undefined => sessions.filter((session) => session.worktree === place.worktree).at(-1);

function runnerAt(place: Place, now: Date): Session {
  const stamp = now.toISOString();
  return { id: RUNNER_AGENT, track: place.track, worktree: place.worktree, branch: place.branch, agent: RUNNER_AGENT, openedAt: stamp, lastSeenAt: stamp };
}

async function taskOf(repo: Repo, session: Session, named: string): Promise<{ milestone: string; task: string }> {
  if (named !== "") {
    const cut = named.indexOf(":");
    if (cut <= 0 || cut === named.length - 1) throw new TallyError(`--task takes MILESTONE:TASK, not '${named}'`);
    return { milestone: named.slice(0, cut), task: named.slice(cut + 1) };
  }
  const held = (await listClaims(repo)).find((claim) => claim.sessionId === session.id);
  if (held === undefined) throw new TallyError("the run names no task, and no session in this worktree holds one; pass --task MILESTONE:TASK");
  return { milestone: held.milestone, task: held.task };
}

function kindOf(name: string): EvidenceKind {
  const kind = evidenceKinds.find((known) => known === name);
  if (kind === undefined) throw new TallyError(`'${name}' is not a kind of run; the kinds are ${evidenceKinds.join(", ")}`);
  return kind;
}

async function record(repo: Repo, session: Session, folder: string): Promise<Pick<Taken, "record" | "notice">> {
  const kind = kindOf(await field(folder, "kind"));
  const target = await taskOf(repo, session, await field(folder, "task"));
  const note = await field(folder, "note");
  const command = (await field(folder, "argv")).split("\0").filter((part, index, parts) => index < parts.length - 1 || part !== "");
  const kept = await recordEvidence(repo, session, await new Records(repo).readLedger(), {
    ...target,
    kind,
    command,
    cwd: await field(folder, "cwd"),
    started: await field(folder, "started"),
    seconds: Number(await field(folder, "seconds")),
    exit: Number(await field(folder, "exit")),
    logPath: await field(folder, "log"),
    ...(note === "" ? {} : { note }),
    ...(await ranOn(folder)),
  });
  return { record: kept.record, ...(kept.notice === undefined ? {} : { notice: kept.notice }) };
}

async function claimed(results: string, from: string, id: string): Promise<string | undefined> {
  const mine = `${id}${CLAIMED}`;
  try {
    await rename(join(from, id), join(results, mine));
    return mine;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function abandoned(results: string, now: Date): Promise<void> {
  const entries = await readdir(results, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter((one) => one.isDirectory() && one.name.endsWith(CLAIMED))) {
    const age = now.getTime() - (await stat(join(results, entry.name))).mtimeMs;
    if (age > ABANDONED_MS) await rename(join(results, entry.name), join(results, entry.name.slice(0, -CLAIMED.length))).catch(() => undefined);
  }
}

const MOST_COMMAND = 160;
const UNTOLD = "untold";

async function whatRan(folder: string): Promise<string> {
  const kind = await field(folder, "kind").catch(() => "a run");
  const argv = await field(folder, "argv").catch(() => "");
  const command = argv.split("\0").filter((part) => part !== "").join(" ");
  const shown = command.length > MOST_COMMAND ? `${command.slice(0, MOST_COMMAND)}…` : command;
  return shown === "" ? kind : `${kind}: ${shown}`;
}

async function tellRefused(repo: Repo, place: Place, id: string, problem: string, now: Date): Promise<string> {
  const kept = join(place.worktree, RESULTS, REFUSED, id);
  const where = `; the result is kept in ${kept} and tried again when the ledger changes`;
  const said = `the run ${id} (${await whatRan(kept)}) was not recorded: ${problem}`;
  const text = `${said.slice(0, MAX_NOTE - where.length)}${where}`;
  try {
    await noteFrom(repo, { track: repo.config.mainBranch, agent: TALLY }, { to: [place.track], kind: "heads-up", text }, now);
    return problem;
  } catch (error: unknown) {
    const written = (await readNotes(repo).catch(() => undefined))?.notes.some((note) => note.text === text) === true;
    if (written) return `${problem}; the note to ${place.track} is written but not committed: ${messageOf(error)}`;
    await writeFile(join(kept, UNTOLD), `${messageOf(error)}\n`);
    return `${problem}; the track was not told: ${messageOf(error)}`;
  }
}

const problemIn = (folder: string): Promise<string | undefined> => readFile(join(folder, PROBLEM), "utf8").then((text) => text.replace(/\n$/, ""), () => undefined);

interface Pass {
  repo: Repo;
  place: Place;
  session: Session;
  ledgerAt: number;
  now: Date;
}

async function refusedAgain(pass: Pass, id: string, folder: string, problem: string): Promise<Taken> {
  const { repo, place, now } = pass;
  const results = join(place.worktree, RESULTS);
  const before = await problemIn(folder);
  await mkdir(join(results, REFUSED), { recursive: true });
  await writeFile(join(folder, PROBLEM), `${problem}\n`);
  await utimes(join(folder, PROBLEM), now, new Date(pass.ledgerAt));
  await rename(folder, join(results, REFUSED, id));
  const told = before === problem ? problem : await tellRefused(repo, place, id, problem, now);
  return { id, worktree: place.worktree, problem: told };
}

async function takeOne(pass: Pass, from: string, id: string): Promise<Taken | undefined> {
  const results = join(pass.place.worktree, RESULTS);
  const mine = await claimed(results, from, id);
  if (mine === undefined) return undefined;
  const folder = join(results, mine);
  if (from !== results) await utimes(folder, pass.now, pass.now);
  try {
    const kept = await record(pass.repo, pass.session, folder);
    await rm(join(folder, PROBLEM), { force: true });
    await mkdir(join(results, TAKEN), { recursive: true });
    await rename(folder, join(results, TAKEN, id));
    return { id, worktree: pass.place.worktree, ...kept };
  } catch (error: unknown) {
    if (!(error instanceof TallyError)) throw error;
    return refusedAgain(pass, id, folder, messageOf(error));
  }
}

async function ledgerChangedAt(repo: Repo): Promise<number> {
  return stat(join(repo.recordsDir, LEDGER_FILE)).then((file) => Math.floor(file.mtimeMs), () => 0);
}

async function dueAgain(results: string, ledgerAt: number): Promise<string[]> {
  const folder = join(results, REFUSED);
  const ids = (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const due: string[] = [];
  for (const id of ids) {
    if (due.length >= MOST_RETRIED) break;
    const refusedAt = await stat(join(folder, id, PROBLEM)).then((file) => Math.floor(file.mtimeMs), () => undefined);
    if (refusedAt !== undefined && refusedAt < ledgerAt) due.push(id);
  }
  return due;
}

async function takeEach(pass: Pass, from: string, ids: readonly string[]): Promise<Taken[]> {
  const taken: Taken[] = [];
  for (const id of ids) {
    const one = await takeOne(pass, from, id);
    if (one !== undefined) taken.push(one);
  }
  return taken;
}

async function takeAt(repo: Repo, place: Place, ledgerAt: number, now: Date): Promise<Taken[]> {
  const results = join(place.worktree, RESULTS);
  await abandoned(results, now);
  const fresh = await waiting(results);
  const again = await dueAgain(results, ledgerAt);
  if (fresh.length === 0 && again.length === 0) return [];
  const open = openAt(place, await listSessions(repo));
  const pass: Pass = { repo, place, session: open ?? runnerAt(place, now), ledgerAt, now };
  const here = await takeEach(pass, results, fresh);
  const retried = await takeEach(pass, join(results, REFUSED), again);
  if (open !== undefined && here.length > 0) await markSeen(repo, open.id, now);
  return [...here, ...retried];
}

export async function takeResults(repo: Repo, now = new Date()): Promise<Taken[]> {
  const ledgerAt = await ledgerChangedAt(repo);
  const taken: Taken[] = [];
  for (const place of placesOf(repo)) taken.push(...(await takeAt(repo, place, ledgerAt, now)));
  return taken;
}
