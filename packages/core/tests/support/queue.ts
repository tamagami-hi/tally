import { execFile } from "node:child_process";
import { join } from "node:path";
import { queueFile, type JoinInput } from "../../src/land/queue.ts";
import { openSession, type Session } from "../../src/state/sessions.ts";
import type { Repo } from "../../src/store/records.ts";
import { landingFixture, type LandingFixture } from "./landing.ts";
import { sh } from "./repo.ts";

const MESSAGE = "feat(data): the task\n\nwhy it is so\n";

export interface Queued extends LandingFixture {
  session: Session;
  engine: { tree: string; session: Session };
}

export async function ready(script = "true"): Promise<Queued> {
  const fixture = await landingFixture(script);
  const engineTree = join(fixture.root, ".temp", "worktrees", "engine");
  await sh(fixture.root, ["worktree", "add", "-q", engineTree, "-b", "track/engine", "main"]);
  const repo: Repo = { ...fixture.repo, config: { ...fixture.repo.config, tracks: [...fixture.repo.config.tracks, { name: "engine", worktree: ".temp/worktrees/engine", branch: "track/engine" }] } };
  const session = await openSession(repo, { worktree: fixture.tree, agent: "claude" });
  const engine = { tree: engineTree, session: await openSession(repo, { worktree: engineTree, agent: "kiro" }) };
  return { ...fixture, repo, session, engine };
}

export const landing = (files: string[], extra: Partial<JoinInput> = {}): JoinInput => ({ files, message: MESSAGE, ...extra });

export function runCommand(command: string): Promise<number> {
  return new Promise((done) => {
    execFile("sh", ["-c", command], (error) => done(error === null ? 0 : typeof error.code === "number" ? error.code : 1));
  });
}

export async function runHead(repo: Repo): Promise<number> {
  const head = (await queueFile(repo).read()).tickets.find((ticket) => ticket.state === "turn");
  if (head?.turn === undefined) throw new Error("no ticket is in its turn");
  return runCommand(`sh ${head.turn.script}`);
}
