import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { currentBranch } from "../git/refs.ts";
import { asIdentity, git, gitMust } from "../git/run.ts";
import { flushWhenFree } from "../records/commit.ts";
import { listSessions } from "../state/sessions.ts";
import { LockBusy, withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { checkCheckout } from "./checks.ts";
import { openLandingCheckout } from "./checkout.ts";
import { undoCommit } from "./clean.ts";
import { landScript } from "./land-script.ts";
import { statePath, trackOf } from "./paths.ts";
import { isActive, putTicket, queueFile, type Ticket } from "./queue.ts";
import { recordLanding } from "./record.ts";
import { LOGS } from "./runner.ts";

export const LANDING_DIR = ".temp/tally/landing";
export const LAND_SCRIPT = ".temp/tally/land.sh";

const START_MS = 120_000;
const STALL_MS = 60_000;
const LIMIT_MS = 3_600_000;
const SHORT_HASH = 7;
const MAX_STEPS = 50;
const QUICK = { retries: 8, minTimeout: 50, maxTimeout: 150 };
const MAIN_MOVED = "main moved while the checks ran, so the turn was prepared again; run the script again";
const BEHIND = "bring it up to main yourself: git rebase main";

interface Committed {
  before: string;
  tip: string;
}

interface Result {
  exit: number;
  log: string;
  commits: { sha: string; exit: number }[];
}

const short = (sha: string): string => sha.slice(0, SHORT_HASH);

const resultDir = (ticket: Ticket): string => join(ticket.worktree, LANDING_DIR, ticket.id);

const ended = (ticket: Ticket, state: "landed" | "failed", now: Date, more: Partial<Ticket>): Ticket => {
  const { turn: _turn, ...rest } = ticket;
  return { ...rest, ...more, state, endedAt: now.toISOString() };
};

async function failed(ticket: Ticket, made: Committed | undefined, now: Date, problem: string): Promise<Ticket> {
  const undone = made === undefined || made.tip === made.before || ticket.message === undefined ? "" : `; ${await undoCommit(ticket.worktree, made.before, made.tip)}`;
  return ended(ticket, "failed", now, { problem: `${problem}${undone}` });
}

async function commitNamed(repo: Repo, ticket: Ticket): Promise<Committed> {
  const tree = ticket.worktree;
  const before = await gitMust(tree, ["rev-parse", "HEAD"]);
  if (ticket.message === undefined) return { before, tip: before };
  const file = statePath(repo, "landing", `${ticket.id}.txt`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, ticket.message);
  await gitMust(tree, ["diff", "--check", "--", ...ticket.files]);
  await gitMust(tree, ["add", "--", ...ticket.files]);
  await gitMust(tree, [...asIdentity(repo.config.identity), "commit", "--quiet", "--file", file, "--", ...ticket.files]);
  return { before, tip: await gitMust(tree, ["rev-parse", "HEAD"]) };
}

async function rebased(repo: Repo, checkout: string, track: string, tip: string): Promise<string> {
  const main = repo.config.mainBranch;
  await gitMust(checkout, ["checkout", "--quiet", "--detach", "--force", tip]);
  await gitMust(checkout, ["clean", "--quiet", "-fd"]);
  const result = await git(checkout, [...asIdentity(repo.config.identity), "rebase", "--quiet", main]);
  if (result.code !== 0) {
    const files = (await gitMust(checkout, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter((line) => line !== "").join(", ");
    await git(checkout, ["rebase", "--abort"]);
    throw new TallyError(`${track} does not rebase onto ${main}: ${files === "" ? result.stderr.trim() : files}; rebase your branch yourself, then land again`);
  }
  return gitMust(checkout, ["rev-parse", "HEAD"]);
}

async function prepare(repo: Repo, ticket: Ticket, now: Date): Promise<Ticket> {
  const { config, root } = repo;
  let made = ticket.committed;
  try {
    const track = trackOf(config, ticket.track);
    await checkCheckout(repo);
    if ((await currentBranch(ticket.worktree)) !== track.branch) throw new TallyError("worktree is not on its track branch");
    made = made ?? (await commitNamed(repo, ticket));
    const base = await gitMust(root, ["rev-parse", config.mainBranch]);
    const checkout = await openLandingCheckout(ticket.worktree, track.name);
    const top = await rebased(repo, checkout, track.name, made.tip);
    const commits = (await gitMust(checkout, ["rev-list", "--reverse", `${base}..${top}`])).split("\n").filter((line) => line !== "");
    if (commits.length === 0) return ended(ticket, "landed", now, { committed: made, landed: { head: short(base), commits: [] }, note: "nothing new to land" });
    const script = join(ticket.worktree, LAND_SCRIPT);
    await mkdir(dirname(script), { recursive: true });
    await writeFile(script, landScript({ repo, track, tree: ticket.worktree, checkout, commits, resultDir: resultDir(ticket), log: join(root, LOGS, track.name, `land-${ticket.id}.log`) }));
    await chmod(script, 0o755);
    return { ...ticket, state: "turn", committed: made, turn: { startedAt: now.toISOString(), base, rebased: top, commits, script } };
  } catch (error: unknown) {
    if (!(error instanceof TallyError)) throw error;
    return failed(ticket, made, now, messageOf(error));
  }
}

async function readResult(folder: string): Promise<Result | undefined> {
  try {
    const lines = (await readFile(join(folder, "commits"), "utf8")).split("\n").filter((line) => line !== "");
    return {
      exit: Number((await readFile(join(folder, "exit"), "utf8")).trim()),
      log: (await readFile(join(folder, "log"), "utf8")).trim(),
      commits: lines.map((line) => {
        const [sha = "", exit = "1"] = line.split(" ");
        return { sha, exit: Number(exit) };
      }),
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function stalled(ticket: Ticket, startedAt: string, now: Date): Promise<string | undefined> {
  const waited = now.getTime() - new Date(startedAt).getTime();
  if (waited > LIMIT_MS) return `it passed the turn's limit of ${LIMIT_MS / 60_000} minutes`;
  const beat = await stat(`${resultDir(ticket)}.beat`).catch(() => undefined);
  if (beat === undefined) return waited > START_MS ? `the script was not started within ${START_MS / 60_000} minutes` : undefined;
  return now.getTime() - beat.mtimeMs > STALL_MS ? "the script stopped and left no result" : undefined;
}

async function follow(ticket: Ticket, made: Committed, top: string): Promise<string | undefined> {
  if ((await gitMust(ticket.worktree, ["rev-parse", "HEAD"])) !== made.tip) return `the landing is done; your worktree has commits made since, so ${BEHIND}`;
  const reset = await git(ticket.worktree, ["reset", "--quiet", "--keep", top]);
  return reset.code === 0 ? undefined : `the landing is done; main changed a file you have open changes in, so ${BEHIND}`;
}

async function settle(repo: Repo, ticket: Ticket, now: Date): Promise<Ticket | undefined> {
  const { turn, committed: made } = ticket;
  if (turn === undefined || made === undefined) return failed(ticket, made, now, "the ticket lost its turn's details");
  const result = await readResult(resultDir(ticket));
  if (result === undefined) {
    const why = await stalled(ticket, turn.startedAt, now);
    return why === undefined ? undefined : failed(ticket, made, now, `its turn timed out: ${why}`);
  }
  try {
    const bad = result.commits.find((commit) => commit.exit !== 0);
    if (bad !== undefined || result.exit !== 0) throw new TallyError(`${short(bad?.sha ?? turn.rebased)} failed its checks (exit ${bad?.exit ?? result.exit}); the log is ${result.log}`);
    if (result.commits.map((commit) => commit.sha).join() !== turn.commits.join()) throw new TallyError("the result is not for the commits being landed");
    if ((await gitMust(repo.root, ["rev-parse", repo.config.mainBranch])) !== turn.base) {
      await rename(resultDir(ticket), `${resultDir(ticket)}.stale-${now.getTime()}`);
      const { turn: _turn, ...waiting } = ticket;
      const again = await prepare(repo, { ...waiting, state: "queued" }, now);
      return again.state === "turn" ? { ...again, note: MAIN_MOVED } : again;
    }
    await checkCheckout(repo);
    await gitMust(repo.root, ["merge", "--quiet", "--ff-only", turn.rebased]);
    const note = await follow(ticket, made, turn.rebased);
    return ended(ticket, "landed", now, { landed: { head: short(turn.rebased), commits: turn.commits.map(short) }, ...(note === undefined ? {} : { note }) });
  } catch (error: unknown) {
    if (!(error instanceof TallyError)) throw error;
    return failed(ticket, made, now, messageOf(error));
  }
}

async function step(repo: Repo, now: Date): Promise<Ticket | undefined> {
  return withLock(statePath(repo, "locks", "landing.lock"), async () => {
    const head = (await queueFile(repo).read()).tickets.find(isActive);
    if (head === undefined) return undefined;
    const next = head.state === "queued" ? await prepare(repo, head, now) : await settle(repo, head, now);
    return next === undefined ? undefined : putTicket(repo, next);
  }, QUICK);
}

async function recorded(repo: Repo, ticket: Ticket): Promise<void> {
  const { landed, target } = ticket;
  if (landed === undefined || landed.commits.length === 0) return;
  if (target !== undefined) {
    const session = (await listSessions(repo)).find((open) => open.id === ticket.sessionId);
    const recording = await recordLanding(repo, { track: ticket.track, head: landed.head, commits: landed.commits }, target, session);
    await putTicket(repo, { ...ticket, landed: { ...landed, recording: recording.problem === undefined ? recording.message : `${recording.message}; ${recording.problem}` } });
  }
  await flushWhenFree(repo);
}

export async function advance(repo: Repo, now = new Date()): Promise<void> {
  try {
    for (let steps = 0; steps < MAX_STEPS; steps += 1) {
      const moved = await step(repo, now);
      if (moved === undefined || moved.state === "turn") return;
      if (moved.state === "landed") await recorded(repo, moved);
    }
  } catch (error: unknown) {
    if (!(error instanceof LockBusy)) throw error;
  }
}
