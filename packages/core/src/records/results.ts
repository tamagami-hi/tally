import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { worktreeOf } from "../land/paths.ts";
import { RESULTS } from "../land/runner.ts";
import { listClaims } from "../state/claims.ts";
import { listSessions, markSeen, type Session } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import { evidenceKinds, recordEvidence, type EvidenceKind, type RunRecord } from "./evidence.ts";
import { MAX_NOTE, noteFrom } from "./notes.ts";
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
const PARTIAL = ".tmp";
const CLAIMED = ".taking";
const ABANDONED_MS = 60_000;
const RUNNER_AGENT = "runner";

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
  });
  return { record: kept.record, ...(kept.notice === undefined ? {} : { notice: kept.notice }) };
}

async function claimed(results: string, id: string): Promise<string | undefined> {
  const mine = `${id}${CLAIMED}`;
  try {
    await rename(join(results, id), join(results, mine));
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

async function whatRan(folder: string): Promise<string> {
  const kind = await field(folder, "kind").catch(() => "a run");
  const argv = await field(folder, "argv").catch(() => "");
  const command = argv.split("\0").filter((part) => part !== "").join(" ");
  return command === "" ? kind : `${kind}: ${command}`;
}

async function tellRefused(repo: Repo, place: Place, id: string, problem: string, now: Date): Promise<string> {
  const kept = join(place.worktree, RESULTS, REFUSED, id);
  const text = `the run ${id} (${await whatRan(kept)}) was not recorded: ${problem}; the result is kept in ${kept}`;
  try {
    await noteFrom(repo, { track: repo.config.mainBranch, agent: TALLY }, { to: [place.track], kind: "heads-up", text: text.slice(0, MAX_NOTE) }, now);
    return problem;
  } catch (error: unknown) {
    return `${problem}; the track was not told: ${messageOf(error)}`;
  }
}

async function takeOne(repo: Repo, place: Place, session: Session, id: string, now: Date): Promise<Taken | undefined> {
  const results = join(place.worktree, RESULTS);
  const mine = await claimed(results, id);
  if (mine === undefined) return undefined;
  try {
    const kept = await record(repo, session, join(results, mine));
    await mkdir(join(results, TAKEN), { recursive: true });
    await rename(join(results, mine), join(results, TAKEN, id));
    return { id, worktree: place.worktree, ...kept };
  } catch (error: unknown) {
    if (!(error instanceof TallyError)) throw error;
    const problem = messageOf(error);
    await mkdir(join(results, REFUSED), { recursive: true });
    await writeFile(join(results, mine, "problem"), `${problem}\n`);
    await rename(join(results, mine), join(results, REFUSED, id));
    return { id, worktree: place.worktree, problem: await tellRefused(repo, place, id, problem, now) };
  }
}

export async function takeResults(repo: Repo, now = new Date()): Promise<Taken[]> {
  const taken: Taken[] = [];
  for (const place of placesOf(repo)) {
    await abandoned(join(place.worktree, RESULTS), now);
    const ids = await waiting(join(place.worktree, RESULTS));
    if (ids.length === 0) continue;
    const open = openAt(place, await listSessions(repo));
    const here: Taken[] = [];
    for (const id of ids) {
      const one = await takeOne(repo, place, open ?? runnerAt(place, now), id, now);
      if (one !== undefined) here.push(one);
    }
    if (open !== undefined && here.length > 0) await markSeen(repo, open.id, now);
    taken.push(...here);
  }
  return taken;
}
