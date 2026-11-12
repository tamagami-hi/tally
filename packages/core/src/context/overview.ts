import type { Ledger } from "../schema/ledger.ts";
import type { Claim } from "../state/claims.ts";
import type { HeldLock } from "../state/locks.ts";
import type { Session } from "../state/sessions.ts";
import type { OpenQuestions } from "../status/questions.ts";
import { ownersOf } from "../status/summary.ts";
import type { Repo } from "../store/records.ts";

export interface Live {
  claims: Claim[];
  locks: HeldLock[];
  sessions: Session[];
}

export interface Overview {
  parts: Record<string, unknown>;
  lines: string[];
}

export function overview(repo: Repo, ledger: Ledger, live: Live, questions: OpenQuestions): Overview {
  const { claims, locks, sessions } = live;
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
  };
  const lines = [
    `# ${repo.config.name}: project context`,
    "",
    `Tracks: ${repo.config.tracks.map((t) => `${t.name} (${t.worktree}, ${t.branch})`).join("; ") || "none, work alone on " + repo.config.mainBranch}.`,
    `Milestones: ${parts.milestones.map((m) => `${m.id} ${m.built !== null ? "built" : `${m.landed}/${m.tasks}`}`).join(", ")}.`,
    `Open questions: ${questions.rows.join(", ") || "none"}; next row ${questions.nextRow ?? "unknown"}.`,
    `Sessions: ${sessions.map((s) => `${s.agent} on ${s.track}`).join(", ") || "none"}. Locks held: ${locks.map((l) => `${l.name} by ${l.agent}`).join(", ") || "none"}.`,
  ];
  return { parts, lines };
}
