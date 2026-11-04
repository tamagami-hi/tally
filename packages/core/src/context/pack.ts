import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import { listEvidence, type RunRecord } from "../records/evidence.ts";
import { readHandoff, type Handoff } from "../records/handoffs.ts";
import type { Ledger, Milestone, Task } from "../schema/ledger.ts";
import { listClaims, type Claim } from "../state/claims.ts";
import { listLocks, type HeldLock } from "../state/locks.ts";
import { listSessions, type Session } from "../state/sessions.ts";
import { openQuestions } from "../status/questions.ts";
import { ownersOf } from "../status/summary.ts";
import type { Repo } from "../store/records.ts";
import { Records } from "../store/records.ts";

export type Level = "project" | "track" | "milestone" | "task";

export interface PackInput {
  level: Level;
  track?: string;
  milestone?: string;
  task?: string;
}

export interface Pack {
  level: Level;
  parts: Record<string, unknown>;
  text: string;
}

async function optional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function tasksOf(ledger: Ledger, track: string): { milestone: string; task: Task }[] {
  return ledger.milestones.flatMap((m) => m.tasks.filter((t) => t.track === track).map((task) => ({ milestone: m.id, task })));
}

function taskLine(milestone: string, task: Task, claims: Claim[]): string {
  const claim = claims.find((c) => c.milestone === milestone && c.task === task.id);
  const state = task.commit !== undefined ? `landed ${task.commit}` : task.waits !== undefined ? `waits for ${task.waits}` : claim !== undefined ? `claimed by ${claim.agent} since ${claim.since}` : "planned";
  return `- ${milestone} / ${task.id}: ${state}`;
}

export async function contextPack(repo: Repo, input: PackInput): Promise<Pack> {
  const ledger = await new Records(repo).readLedger();
  const claims = await listClaims(repo);
  const locks = await listLocks(repo);
  const sessions = await listSessions(repo);
  switch (input.level) {
    case "project":
      return project(repo, ledger, claims, locks, sessions);
    case "track": {
      if (input.track === undefined) throw new TallyError("a track pack needs the track");
      return track(repo, ledger, input.track, claims, locks, sessions);
    }
    case "milestone": {
      if (input.milestone === undefined) throw new TallyError("a milestone pack needs the milestone");
      return milestone(repo, findMilestone(ledger, input.milestone), claims);
    }
    case "task": {
      if (input.milestone === undefined || input.task === undefined) throw new TallyError("a task pack needs the milestone and the task");
      const m = findMilestone(ledger, input.milestone);
      const t = findTask(m, input.task);
      if (t === undefined) throw new TallyError(`'${input.task}' is not planned in ${input.milestone}`);
      return task(repo, m, t, claims);
    }
  }
}

async function project(repo: Repo, ledger: Ledger, claims: Claim[], locks: HeldLock[], sessions: Session[]): Promise<Pack> {
  const rules = await optional(join(repo.root, "RULES.md"));
  const claude = await optional(join(repo.root, "CLAUDE.md"));
  const questions = await openQuestions(repo);
  const parts = {
    name: repo.config.name,
    mainBranch: repo.config.mainBranch,
    tracks: repo.config.tracks,
    stages: repo.config.stages,
    locks: repo.config.locks,
    milestones: ledger.milestones.map((m) => ({ id: m.id, stage: m.stage, name: m.name, track: ownersOf(m), built: m.built ?? null, tasks: m.tasks.length, landed: m.tasks.filter((t) => t.commit !== undefined).length })),
    openQuestions: questions.rows,
    nextQuestionRow: questions.nextRow,
    sessions: sessions.map((s) => ({ id: s.id, track: s.track, agent: s.agent, since: s.openedAt })),
    claims,
    heldLocks: locks,
    rules,
    claude,
  };
  const text = [
    `# ${repo.config.name}: project context`,
    "",
    `Tracks: ${repo.config.tracks.map((t) => `${t.name} (${t.worktree}, ${t.branch})`).join("; ") || "none, work alone on " + repo.config.mainBranch}.`,
    `Milestones: ${parts.milestones.map((m) => `${m.id} ${m.built !== null ? "built" : `${m.landed}/${m.tasks}`}`).join(", ")}.`,
    `Open questions: ${questions.rows.join(", ") || "none"}; next row ${questions.nextRow ?? "unknown"}.`,
    `Sessions: ${sessions.map((s) => `${s.agent} on ${s.track}`).join(", ") || "none"}. Locks held: ${locks.map((l) => `${l.name} by ${l.agent}`).join(", ") || "none"}.`,
    "",
    rules === null ? "(no RULES.md)" : `## RULES.md\n\n${rules}`,
    "",
    claude === null ? "(no CLAUDE.md)" : `## CLAUDE.md\n\n${claude}`,
  ].join("\n");
  return { level: "project", parts, text };
}

async function track(repo: Repo, ledger: Ledger, name: string, claims: Claim[], locks: HeldLock[], sessions: Session[]): Promise<Pack> {
  const config = repo.config.tracks.find((t) => t.name === name);
  if (config === undefined && name !== repo.config.mainBranch) throw new TallyError(`no track '${name}'`);
  const tasks = tasksOf(ledger, name);
  const handoff: Handoff = await readHandoff(repo, name);
  const parts = { track: name, worktree: config?.worktree ?? ".", branch: config?.branch ?? repo.config.mainBranch, tasks, handoff, claims: claims.filter((c) => c.track === name), locks: locks.filter((l) => l.track === name), sessions: sessions.filter((s) => s.track === name) };
  const text = [
    `# Track ${name}`,
    "",
    `Worktree ${parts.worktree} on branch ${parts.branch}.`,
    "",
    "## Tasks",
    ...tasks.map(({ milestone, task }) => taskLine(milestone, task, claims)),
    "",
    "## Current hand-off",
    handoff.current === undefined ? "(none)" : [`From ${handoff.current.from} at ${handoff.current.at}${handoff.current.task === undefined ? "" : `, on ${handoff.current.task}`}:`, ...handoff.current.lines].join("\n"),
  ].join("\n");
  return { level: "track", parts, text };
}

async function milestone(repo: Repo, m: Milestone, claims: Claim[]): Promise<Pack> {
  const evidence = await listEvidence(repo, m.id);
  const counts = Object.fromEntries(m.tasks.map((t) => [t.id, evidence.filter((e) => e.task === t.id).length]));
  const parts = { milestone: m, evidenceCounts: counts, claims: claims.filter((c) => c.milestone === m.id) };
  const text = [
    `# ${m.id} ${m.name} (stage ${m.stage}, track ${ownersOf(m)}${m.built === undefined ? "" : `, built ${m.built}`})`,
    "",
    ...m.tasks.map((t) => `${taskLine(m.id, t, claims)}; evidence records: ${counts[t.id] ?? 0}`),
  ].join("\n");
  return { level: "milestone", parts, text };
}

async function task(repo: Repo, m: Milestone, t: Task, claims: Claim[]): Promise<Pack> {
  const evidence: RunRecord[] = await listEvidence(repo, m.id, t.id);
  const handoff = await readHandoff(repo, t.track);
  const parts = { milestone: { id: m.id, name: m.name, stage: m.stage }, task: t, evidence, handoff: handoff.current ?? null, claim: claims.find((c) => c.milestone === m.id && c.task === t.id) ?? null };
  const text = [
    `# ${m.id} / ${t.id} (track ${t.track})`,
    "",
    taskLine(m.id, t, claims),
    "",
    "## Evidence",
    ...(evidence.length === 0 ? ["(none yet)"] : evidence.map((e) => `- ${e.kind} exit ${e.exit} in ${e.seconds}s at ${e.started}: ${e.command.join(" ")}${e.summary === undefined ? "" : ` ${JSON.stringify(e.summary)}`}`)),
    "",
    "## Hand-off",
    handoff.current === undefined ? "(none)" : handoff.current.lines.join("\n"),
  ].join("\n");
  return { level: "task", parts, text };
}
