import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { landingEnvironment } from "../land/run.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import type { Session } from "../state/sessions.ts";
import { recordEvidence, type EvidenceKind, type RunRecord } from "./evidence.ts";
import { safeName } from "./handoffs.ts";

export interface RunInput {
  milestone: string;
  task: string;
  kind: EvidenceKind;
  command: readonly string[];
  note?: string;
}

export function summarize(text: string): Record<string, number> | undefined {
  const totals = { passed: 0, failed: 0, ignored: 0 };
  let seen = false;
  for (const match of text.matchAll(/(\d+) passed; (\d+) failed; (\d+) ignored/g)) {
    seen = true;
    totals.passed += Number(match[1]);
    totals.failed += Number(match[2]);
    totals.ignored += Number(match[3]);
  }
  for (const match of text.matchAll(/Tests\s+(?:(\d+) failed \| )?(\d+) passed/g)) {
    seen = true;
    totals.failed += Number(match[1] ?? 0);
    totals.passed += Number(match[2]);
  }
  return seen ? totals : undefined;
}

export async function runEvidence(repo: Repo, session: Session, ledger: Ledger, input: RunInput, now = new Date()): Promise<{ record: RunRecord; commit: string | null; logPath: string }> {
  const [program, ...args] = input.command;
  if (program === undefined) throw new TallyError("the command is empty");
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
    child.on("error", (error) => fail(new TallyError(`${input.command.join(" ")} could not start: ${error.message}`)));
    child.on("close", (code) => file.end(() => done({ exit: code ?? 1, text: chunks.join("") })));
  });
  const summary = summarize(text);
  const result = await recordEvidence(repo, session, ledger, {
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
  return { ...result, logPath };
}
