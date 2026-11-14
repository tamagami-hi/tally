import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { landingEnvironment } from "../land/run.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import type { Session } from "../state/sessions.ts";
import { runnerLine } from "../land/runner.ts";
import { isUnstarted, keepRun, writableTrack, type EvidenceKind, type Kept } from "./evidence.ts";
import { safeName } from "./handoffs.ts";
import { summarize } from "./totals.ts";

export interface RunInput {
  milestone: string;
  task: string;
  kind: EvidenceKind;
  command: readonly string[];
  note?: string;
}

const MOST_LAST_LINE = 200;
const NOT_FOUND = "ENOENT";
const ELSEWHERE = "this service runs in a container without the project's tools, so it runs no command; run the line in your own shell: the runner records the run, and evidence_list shows the record a few seconds later";

const lineOf = (session: Session, input: RunInput): string => runnerLine(session.worktree, input);

function lastLine(text: string): string {
  const line = text.trimEnd().split("\n").at(-1) ?? "";
  return line === "" ? "the log is empty" : `the log ends: ${line.slice(0, MOST_LAST_LINE)}`;
}

function startFailure(session: Session, input: RunInput, program: string, error: NodeJS.ErrnoException): TallyError {
  const command = input.command.join(" ");
  if (error.code !== NOT_FOUND) return new TallyError(`${command} could not start: ${error.message}`);
  return new TallyError(`${command} could not start: ${program} is not found where this service runs; run it in your own shell, and the runner records it: ${lineOf(session, input)}`);
}

function told(session: Session, input: RunInput, kept: Kept, text: string): Kept {
  if (kept.recorded || !isUnstarted(kept.record.exit)) return kept;
  return { ...kept, problem: `${kept.problem ?? "not recorded"}; ${lastLine(text)}; in your own shell: ${lineOf(session, input)}` };
}

export async function runEvidence(repo: Repo, session: Session, ledger: Ledger, input: RunInput, now = new Date()): Promise<Kept & { logPath: string }> {
  const [program, ...args] = input.command;
  if (program === undefined) throw new TallyError("the command is empty");
  const track = writableTrack(repo, session, ledger, input);
  const folder = join(session.worktree, ".temp", safeName(session.track), "tally", safeName(input.milestone));
  await mkdir(folder, { recursive: true });
  const stamp = now.toISOString().replaceAll(/[:.]/g, "-");
  const logPath = join(folder, `${stamp}-${input.kind}-${safeName(input.task)}.log`);
  const env = await landingEnvironment(repo, session.worktree, session.track);
  const started = Date.now();
  const { exit, text } = await new Promise<{ exit: number; text: string }>((done, fail) => {
    const chunks: string[] = [];
    const file = createWriteStream(logPath);
    const child = spawn(program, args, { cwd: session.worktree, env, stdio: ["ignore", "pipe", "pipe"] });
    const take = (chunk: Buffer): void => {
      file.write(chunk);
      chunks.push(chunk.toString("utf8"));
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => fail(startFailure(session, input, program, error)));
    child.on("close", (code) => file.end(() => done({ exit: code ?? 1, text: chunks.join("") })));
  });
  const summary = summarize(text);
  const kept = await keepRun(repo, session, track, {
    milestone: input.milestone,
    task: input.task,
    kind: input.kind,
    command: input.command,
    cwd: session.worktree,
    started: now.toISOString(),
    seconds: (Date.now() - started) / 1000,
    exit,
    logPath,
    ...(summary === undefined ? {} : { summary }),
    ...(input.note === undefined ? {} : { note: input.note }),
  });
  return { ...told(session, input, kept, text), logPath };
}

export interface NotRun {
  ran: false;
  run: string;
  why: string;
}

export function runnerInstead(repo: Repo, session: Session, ledger: Ledger, input: RunInput): NotRun {
  if (input.command.length === 0) throw new TallyError("the command is empty");
  writableTrack(repo, session, ledger, input);
  return { ran: false, run: lineOf(session, input), why: ELSEWHERE };
}
