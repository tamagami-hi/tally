import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { worktreeOf } from "../land/paths.ts";
import { RESULTS } from "../land/runner.ts";
import { listClaims } from "../state/claims.ts";
import { listSessions, type Session } from "../state/sessions.ts";
import { Records, type Repo } from "../store/records.ts";
import { evidenceKinds, recordEvidence, type EvidenceKind, type RunRecord } from "./evidence.ts";

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
const RUNNER_AGENT = "runner";

const placesOf = (repo: Repo): Place[] => [
  { worktree: repo.root, track: repo.config.mainBranch, branch: repo.config.mainBranch },
  ...repo.config.tracks.map((track) => ({ worktree: worktreeOf(repo, track), track: track.name, branch: track.branch })),
];

async function waiting(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.endsWith(PARTIAL) && entry.name !== TAKEN && entry.name !== REFUSED).map((entry) => entry.name).sort();
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

function sessionAt(place: Place, sessions: readonly Session[], now: Date): Session {
  const open = sessions.filter((session) => session.worktree === place.worktree).at(-1);
  if (open !== undefined) return open;
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

async function putAway(results: string, id: string, into: string, problem?: string): Promise<void> {
  await mkdir(join(results, into), { recursive: true });
  if (problem !== undefined) await writeFile(join(results, id, "problem"), `${problem}\n`);
  await rename(join(results, id), join(results, into, id));
}

async function takeOne(repo: Repo, place: Place, session: Session, id: string): Promise<Taken> {
  const results = join(place.worktree, RESULTS);
  try {
    const kept = await record(repo, session, join(results, id));
    await putAway(results, id, TAKEN);
    return { id, worktree: place.worktree, ...kept };
  } catch (error: unknown) {
    if (!(error instanceof TallyError)) throw error;
    const problem = messageOf(error);
    await putAway(results, id, REFUSED, problem);
    return { id, worktree: place.worktree, problem };
  }
}

export async function takeResults(repo: Repo, now = new Date()): Promise<Taken[]> {
  const taken: Taken[] = [];
  for (const place of placesOf(repo)) {
    const ids = await waiting(join(place.worktree, RESULTS));
    if (ids.length === 0) continue;
    const session = sessionAt(place, await listSessions(repo), now);
    for (const id of ids) taken.push(await takeOne(repo, place, session, id));
  }
  return taken;
}
