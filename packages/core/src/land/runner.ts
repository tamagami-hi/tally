import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TallyError } from "../errors.ts";
import type { Repo } from "../store/records.ts";

export const RUNNER = ".temp/tally/run";
export const RESULTS = ".temp/tally/results";
export const LOGS = ".temp/tally/logs";
export const RESULT_FIELDS = ["kind", "task", "note", "scope", "head", "dirty", "cwd", "started", "seconds", "exit", "log", "argv"] as const;
export const STATUS_WORDS = ["--no-optional-locks", "status", "--porcelain"] as const;

export const keptByTally = (track: string): string[] => [".temp/tally", `.temp/${track}/tally`, `.temp/${track}/landing`];

export const changesPathspec = (track: string): string[] => ["--", ".", ...keptByTally(track).map((path) => `:(exclude)${path}`)];

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const USAGE = "usage: .temp/tally/run <kind> [--task MILESTONE:TASK] [--note TEXT] [--scope TEXT] -- <command...>";

export const quoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function variable(name: string): string {
  if (!VARIABLE.test(name)) throw new TallyError(`the config names an environment variable a shell cannot set: '${name}'`);
  return name;
}

export function environmentLines(repo: Repo, worktree: string, track: string): string[] {
  const { env, unset, tmpdir } = repo.config.commands;
  const lines = [
    ...Object.entries(env).map(([name, value]) => `export ${variable(name)}=${quoted(value)}`),
    ...unset.map((name) => `unset ${variable(name)}`),
  ];
  if (tmpdir === undefined) return lines;
  const folder = resolve(worktree, tmpdir.replaceAll("{track}", track));
  return [...lines, `mkdir -p ${quoted(folder)}`, `export TMPDIR=${quoted(folder)}`];
}

const TASK_NEEDED = 'if [ -z "$task" ]; then echo "tally: a run in a trial names its task: --task MILESTONE:TASK" >&2; exit 2; fi';

export function runnerScript(repo: Repo, worktree: string, track: string, options: { requireTask?: boolean } = {}): string {
  return [
    "#!/bin/sh",
    "set -u",
    `root=${quoted(repo.root)}`,
    `tree=${quoted(worktree)}`,
    `track=${quoted(track)}`,
    `usage=${quoted(USAGE)}`,
    'if [ "$#" -lt 1 ]; then echo "$usage" >&2; exit 2; fi',
    'kind="$1"; shift',
    'case "$kind" in ""|*[!a-z0-9-]*) echo "$usage" >&2; exit 2 ;; esac',
    "task=''; note=''; scope=''",
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --task) [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 2; }; task="$2"; shift 2 ;;',
    '    --note) [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 2; }; note="$2"; shift 2 ;;',
    '    --scope) [ "$#" -ge 2 ] || { echo "$usage" >&2; exit 2; }; scope="$2"; shift 2 ;;',
    "    --) shift; break ;;",
    '    *) echo "$usage" >&2; exit 2 ;;',
    "  esac",
    "done",
    'if [ "$#" -lt 1 ]; then echo "$usage" >&2; exit 2; fi',
    ...(options.requireTask === true ? [TASK_NEEDED] : []),
    'cwd="$(pwd -P)"',
    'id="$(date -u +%Y%m%dT%H%M%SZ)-$$"',
    `logs="$root/${LOGS}/$track"`,
    `results="$tree/${RESULTS}"`,
    'out="$results/$id.tmp"',
    'mkdir -p "$logs" "$out"',
    'log="$logs/$id-$kind.log"',
    "printf '%s\\0' \"$@\" > \"$out/argv\"",
    ...environmentLines(repo, worktree, track),
    'head="$(git -C "$tree" rev-parse HEAD 2>/dev/null || true)"',
    "dirty=''",
    `if [ -n "$head" ] && changes="$(git -C "$tree" ${[...STATUS_WORDS, ...changesPathspec(track)].map(quoted).join(" ")} 2>/dev/null)"; then if [ -n "$changes" ]; then dirty=true; else dirty=false; fi; fi`,
    'started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
    'began="$(date +%s)"',
    '{ "$@"; echo "$?" > "$out/exit"; } 2>&1 | tee "$log"',
    '[ -s "$out/exit" ] || echo 1 > "$out/exit"',
    'code="$(cat "$out/exit")"',
    'case "$code" in',
    '  127) meaning="the shell did not find a program (126: it could not run it)" ;;',
    '  126) meaning="the shell found a program it could not run (127: it did not find one)" ;;',
    "  *) meaning='' ;;",
    "esac",
    'if [ -n "$meaning" ]; then rm -rf "$out"; echo "tally: not recorded: exit $code means $meaning; fix the command and run it again; the log is $log" >&2; exit "$code"; fi',
    'printf \'%s\\n\' "$kind" > "$out/kind"',
    'printf \'%s\\n\' "$task" > "$out/task"',
    'printf \'%s\\n\' "$note" > "$out/note"',
    'printf \'%s\\n\' "$scope" > "$out/scope"',
    'printf \'%s\\n\' "$head" > "$out/head"',
    'printf \'%s\\n\' "$dirty" > "$out/dirty"',
    'printf \'%s\\n\' "$cwd" > "$out/cwd"',
    'printf \'%s\\n\' "$started" > "$out/started"',
    'printf \'%s\\n\' "$(( $(date +%s) - began ))" > "$out/seconds"',
    'printf \'%s\\n\' "$log" > "$out/log"',
    'mv "$out" "$results/$id"',
    'echo "tally: $kind exited $code; the log is $log; the result is $id" >&2',
    'exit "$code"',
    "",
  ].join("\n");
}

export async function writeRunner(repo: Repo, worktree: string, track: string, options: { requireTask?: boolean } = {}): Promise<string> {
  const path = join(worktree, RUNNER);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, runnerScript(repo, worktree, track, options));
  await chmod(path, 0o755);
  return path;
}

export interface RunnerCall {
  kind: string;
  milestone: string;
  task: string;
  note?: string;
  command: readonly string[];
}

const PLAIN = /^[A-Za-z0-9_@%+:,./-][A-Za-z0-9_@%+=:,./-]*$/;

export const shellWord = (value: string): string => (PLAIN.test(value) ? value : quoted(value));

export function runnerLine(worktree: string, call: RunnerCall): string {
  const note = call.note === undefined ? [] : ["--note", call.note];
  const words = [RUNNER, call.kind, "--task", `${call.milestone}:${call.task}`, ...note, "--", ...call.command];
  return `cd ${shellWord(worktree)} && ${["sh", ...words.map(shellWord)].join(" ")}`;
}
