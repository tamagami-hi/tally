import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { currentBranch } from "../git/refs.ts";
import { asIdentity, git, gitMust } from "../git/run.ts";
import { flushWhenFree } from "../records/commit.ts";
import { listSessions } from "../state/sessions.ts";
import { LockBusy, withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { openLandingCheckout } from "./checkout.ts";
import { undoCommit } from "./clean.ts";
import { landScript } from "./land-script.ts";
import { CHECKS_PASSED, checkCheckout, checkOnMain, filesChanged } from "./operator.ts";
import { turnPlan } from "./path-checks.ts";
import { fingerprint, statePath, trackOf } from "./paths.ts";
import { isActive, putTicket, queueFile, swapTicket, ticketView, type Ticket, type TicketView } from "./queue.ts";
import { recordLanding } from "./record.ts";
import { LOGS } from "./runner.ts";

export const LANDING_DIR = ".temp/tally/landing";

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

const ownerFile = (ticket: Ticket): string => join(ticket.worktree, LANDING_DIR, "owner");

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
  const nothingNew = (await git(tree, ["diff", "--cached", "--quiet", "--", ...ticket.files])).code === 0;
  if (nothingNew) return { before, tip: before };
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

async function refuseRecordChanges(repo: Repo, checkout: string, base: string, top: string): Promise<void> {
  const folder = `${repo.config.records.dir}/`;
  const touched = (await gitMust(checkout, ["diff", "--name-only", `${base}..${top}`])).split("\n").filter((file) => file.startsWith(folder));
  if (touched.length > 0) throw new TallyError(`a landing may not change ${folder} (${touched.join(", ")}); records change through the tools`);
}

async function landVerified(repo: Repo, ticket: Ticket, made: Committed, checkout: string, top: string, commits: readonly string[], now: Date): Promise<Ticket> {
  if ((await fingerprint(repo.root, repo.config)) !== ticket.verified) throw new TallyError("main code differs from the verification; task preserved, recheck changed code");
  if ((await fingerprint(checkout, repo.config)) !== ticket.verified) throw new TallyError("track code differs from the verification; task preserved");
  await gitMust(repo.root, ["merge", "--quiet", "--ff-only", top]);
  const note = (await follow(ticket, made, top)) ?? `landed on the recorded verification of unchanged code ${ticket.verified ?? ""}`;
  return ended(ticket, "landed", now, { committed: made, landed: { head: short(top), commits: commits.map(short) }, note });
}

async function prepare(repo: Repo, ticket: Ticket, now: Date): Promise<Ticket> {
  const { config, root } = repo;
  let made = ticket.committed;
  try {
    const track = trackOf(config, ticket.track);
    if ((track.test ?? config.commands.test).length === 0) throw new TallyError(`the config names no check for track ${track.name}`);
    await checkOnMain(repo);
    if ((await currentBranch(ticket.worktree)) !== track.branch) throw new TallyError("worktree is not on its track branch");
    if (made === undefined) {
      made = await commitNamed(repo, ticket);
      await putTicket(repo, { ...ticket, committed: made });
    }
    const base = await gitMust(root, ["rev-parse", config.mainBranch]);
    const checkout = await openLandingCheckout(ticket.worktree, track.name);
    const top = await rebased(repo, checkout, track.name, made.tip);
    const commits = (await gitMust(checkout, ["rev-list", "--reverse", `${base}..${top}`])).split("\n").filter((line) => line !== "");
    await refuseRecordChanges(repo, checkout, base, top);
    await checkCheckout(repo, await filesChanged(root, `${base}..${top}`));
    if (ticket.verified !== undefined && commits.length > 0) return await landVerified(repo, ticket, made, checkout, top, commits, now);
    if (commits.length === 0) return ended(ticket, "landed", now, { committed: made, landed: { head: short(base), commits: [] }, note: "nothing new to land" });
    const plan = await turnPlan(repo, track, checkout, base, commits, ticket.check ?? "each");
    const attempts = ticket.attempts + 1;
    const name = `${ticket.id}-${attempts}`;
    const result = join(ticket.worktree, LANDING_DIR, name);
    const script = `${result}.sh`;
    await mkdir(dirname(script), { recursive: true });
    await writeFile(`${script}.tmp`, landScript({ repo, track, tree: ticket.worktree, checkout, plan, resultDir: result, log: join(root, LOGS, track.name, `land-${name}.log`), name, owner: ownerFile(ticket) }));
    await chmod(`${script}.tmp`, 0o755);
    await rename(`${script}.tmp`, script);
    await writeFile(`${ownerFile(ticket)}.tmp`, `${name}\n`);
    await rename(`${ownerFile(ticket)}.tmp`, ownerFile(ticket));
    return { ...ticket, state: "turn", attempts, committed: made, turn: { name, startedAt: now.toISOString(), base, rebased: top, commits, ...(ticket.check === "tip" ? { checked: plan.map((one) => one.commit) } : {}), script, result } };
  } catch (error: unknown) {
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

async function stalled(result: string, startedAt: string, now: Date): Promise<string | undefined> {
  const waited = now.getTime() - new Date(startedAt).getTime();
  if (waited > LIMIT_MS) return `it passed the turn's limit of ${LIMIT_MS / 60_000} minutes`;
  const beat = await stat(`${result}.beat`).catch(() => undefined);
  if (beat === undefined) return waited > START_MS ? `the script was not started within ${START_MS / 60_000} minutes` : undefined;
  return now.getTime() - beat.mtimeMs > STALL_MS ? "the script stopped and left no result" : undefined;
}

async function follow(ticket: Ticket, made: Committed, top: string): Promise<string | undefined> {
  const tree = ticket.worktree;
  const moved = `the landing is done; your worktree has commits made since, so ${BEHIND}`;
  if ((await gitMust(tree, ["rev-parse", "HEAD"])) === top) return undefined;
  if ((await gitMust(tree, ["rev-parse", "HEAD"])) !== made.tip) return moved;
  const reset = await git(tree, ["reset", "--quiet", "--keep", top]);
  if (reset.code !== 0) return `the landing is done; main changed a file you have open changes in, so ${BEHIND}`;
  const prior = await gitMust(tree, ["rev-parse", "HEAD@{1}"]);
  if (prior === made.tip) return undefined;
  await git(tree, ["reset", "--quiet", "--keep", prior]);
  return moved;
}

async function settle(repo: Repo, ticket: Ticket, now: Date): Promise<Ticket | undefined> {
  const { turn, committed: made } = ticket;
  if (turn === undefined || made === undefined) return failed(ticket, made, now, "the ticket lost its turn's details");
  const landedNow = (note: string | undefined): Ticket => ended(ticket, "landed", now, { landed: { head: short(turn.rebased), commits: turn.commits.map(short) }, ...(note === undefined ? {} : { note }) });
  try {
    if ((await gitMust(repo.root, ["rev-parse", repo.config.mainBranch])) === turn.rebased) return landedNow(await follow(ticket, made, turn.rebased));
  } catch (error: unknown) {
    return failed(ticket, made, now, messageOf(error));
  }
  const result = await readResult(turn.result);
  if (result === undefined) {
    const why = await stalled(turn.result, turn.startedAt, now);
    return why === undefined ? undefined : failed(ticket, made, now, `its turn timed out: ${why}`);
  }
  try {
    const bad = result.commits.find((commit) => commit.exit !== 0);
    if (bad !== undefined || result.exit !== 0) throw new TallyError(`${short(bad?.sha ?? turn.rebased)} failed its checks (exit ${bad?.exit ?? result.exit}); the log is ${result.log}`);
    if (result.commits.map((commit) => commit.sha).join() !== (turn.checked ?? turn.commits).join()) throw new TallyError("the result is not for the commits being landed");
    if ((await gitMust(repo.root, ["rev-parse", repo.config.mainBranch])) !== turn.base) {
      const { turn: _turn, ...waiting } = ticket;
      const again = await prepare(repo, { ...waiting, state: "queued" }, now);
      return again.state === "turn" ? { ...again, note: MAIN_MOVED } : again;
    }
    await checkCheckout(repo, await filesChanged(repo.root, `${turn.base}..${turn.rebased}`), CHECKS_PASSED);
    await gitMust(repo.root, ["merge", "--quiet", "--ff-only", turn.rebased]);
    return landedNow(await follow(ticket, made, turn.rebased));
  } catch (error: unknown) {
    return failed(ticket, made, now, messageOf(error));
  }
}

async function step(repo: Repo, now: Date): Promise<Ticket | undefined> {
  return withLock(statePath(repo, "locks", "landing.lock"), async () => {
    const head = (await queueFile(repo).read()).tickets.find(isActive);
    if (head === undefined) return undefined;
    const next = head.state === "queued" ? await prepare(repo, head, now) : await settle(repo, head, now);
    if (next === undefined) return undefined;
    const { ticket, swapped } = await swapTicket(repo, head, next);
    if (swapped) return ticket;
    const made = next.committed;
    if (ticket.state === "cancelled" && made !== undefined && made.tip !== made.before && next.message !== undefined) await undoCommit(next.worktree, made.before, made.tip);
    return ticket;
  }, QUICK);
}

async function recorded(repo: Repo, ticket: Ticket): Promise<void> {
  const { landed, target, deferred } = ticket;
  if (landed === undefined || landed.commits.length === 0) return;
  if (target !== undefined) {
    const session = (await listSessions(repo)).find((open) => open.id === ticket.sessionId);
    const recording = await recordLanding(repo, { track: ticket.track, head: landed.head, commits: landed.commits }, { ...target, deferred, ...(ticket.check === "tip" ? { checked: "tip" as const } : {}) }, session);
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

const POLL_MS = 400;
const MS_PER_SECOND = 1000;

export async function waitForTicket(repo: Repo, ticket: string, after: string | undefined, seconds: number): Promise<TicketView> {
  const until = Date.now() + seconds * MS_PER_SECOND;
  for (;;) {
    await advance(repo);
    const view = await ticketView(repo, ticket);
    if ((view.state !== "queued" && view.state !== after) || Date.now() >= until) return view;
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}
