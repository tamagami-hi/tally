import type { Track } from "../schema/config.ts";
import type { Repo } from "../store/records.ts";
import type { CommitChecks, TurnCheck } from "./path-checks.ts";
import { CANCELLED_EXIT, beaterLines, cancelledEnd, stopFunctions } from "./land-stop.ts";
import { environmentLines, quoted, variable } from "./runner.ts";

export interface LandScriptInput {
  repo: Repo;
  track: Track;
  tree: string;
  checkout: string;
  plan: readonly CommitChecks[];
  resultDir: string;
  log: string;
  name: string;
  owner: string;
}

const BEAT_SECONDS = 5;
const REPLACED = 3;

function landingEnvironment({ repo, tree, track }: LandScriptInput): string[] {
  const filled = (value: string): string => value.replaceAll("{worktree}", () => tree).replaceAll("{track}", () => track.name);
  return Object.entries(repo.config.commands.landing?.env ?? {}).map(([name, value]) => `export ${variable(name)}=${quoted(filled(value))}`);
}

function checkLines({ name, command }: TurnCheck): string[] {
  return [
    '  if [ "$one" -eq 0 ] && owns; then',
    ...(name === undefined ? [] : [`    echo ${quoted(`-- check ${name}`)} | tee -a "$log"`]),
    '    rm -f "$out/one"',
    '    if [ "$grouping" = yes ]; then',
    `      { run_check ${command.map(quoted).join(" ")}; echo "$?" > "$out/one"; } 2>&1 | tee -a "$log"`,
    "    else",
    `      run_check ${command.map(quoted).join(" ")} >> "$log" 2>&1; echo "$?" > "$out/one"`,
    "    fi",
    '    one="$(cat "$out/one" 2>/dev/null || echo 1)"',
    '    if [ "$(git -C "$checkout" rev-parse HEAD 2>/dev/null)" != "$commit" ]; then echo "tally: the checkout moved while the checks ran, so this run does not count" | tee -a "$log" >&2; one=1; fi',
    "  fi",
  ];
}

export function landScript(input: LandScriptInput): string {
  const { repo, track, tree, checkout, plan, resultDir, log, name, owner } = input;
  const byCommit = plan.flatMap(({ commit, checks }) => [`    ${quoted(commit)})`, ...checks.flatMap(checkLines).map((line) => `    ${line}`), "      ;;"]);
  const links = (repo.config.commands.landing?.link ?? []).map((path) => `  [ "$one" -ne 0 ] || link ${quoted(path)} >> "$log" 2>&1 || one=1`);
  return [
    "#!/bin/sh",
    "set -u",
    `tree=${quoted(tree)}`,
    `checkout=${quoted(checkout)}`,
    `final=${quoted(resultDir)}`,
    `log=${quoted(log)}`,
    `name=${quoted(name)}`,
    `owner=${quoted(owner)}`,
    'out="$final.tmp"',
    'beat="$final.beat"',
    'owns() { [ "$(cat "$owner" 2>/dev/null)" = "$name" ]; }',
    'if [ -e "$final/exit" ]; then echo "tally: the checks of this turn already ran; call land_wait" >&2; exit "$(cat "$final/exit")"; fi',
    ...stopFunctions(repo.config.commands.landing?.stop),
    `if cancelled; then echo "tally: this landing was cancelled at its turn, so nothing is run" >&2; exit ${CANCELLED_EXIT}; fi`,
    `if ! owns; then echo "tally: this turn was replaced by a later one, so nothing is run; call land_wait" >&2; exit ${REPLACED}; fi`,
    `if ! mkdir "$out" 2>/dev/null; then echo "tally: the checks of this turn are already running" >&2; exit ${REPLACED}; fi`,
    'mkdir -p "$(dirname "$log")"',
    ': > "$log"',
    'touch "$beat"',
    ...beaterLines(BEAT_SECONDS),
    "beater=$!",
    ...environmentLines(repo, tree, track.name),
    ...landingEnvironment(input),
    "link() {",
    '  if [ ! -e "$tree/$1" ]; then echo "the landing cannot link $1: the worktree has none"; return 1; fi',
    '  if [ -e "$checkout/$1" ] && [ ! -L "$checkout/$1" ]; then echo "the landing cannot link $1: the checkout has its own, and the tests must see that"; return 1; fi',
    '  rm -f "$checkout/$1"',
    '  mkdir -p "$(dirname "$checkout/$1")"',
    '  ln -s "$tree/$1" "$checkout/$1"',
    "}",
    "code=0",
    `for commit in ${plan.map(({ commit }) => quoted(commit)).join(" ")}; do`,
    "  if cancelled; then break; fi",
    `  if ! owns; then echo "tally: this turn was replaced by a later one; its checks stop here" | tee -a "$log" >&2; kill "$beater" 2>/dev/null; exit ${REPLACED}; fi`,
    '  echo "== $(git -C "$checkout" log -1 --format=\'%h %s\' "$commit")" | tee -a "$log"',
    "  one=0",
    '  git -C "$checkout" checkout --quiet --detach --force "$commit" >> "$log" 2>&1 && git -C "$checkout" clean --quiet -fd >> "$log" 2>&1 || one=1',
    ...links,
    '  case "$commit" in',
    ...byCommit,
    "  esac",
    '  echo "$commit $one" >> "$out/commits"',
    '  if [ "$one" -ne 0 ]; then code="$one"; break; fi',
    "done",
    ...cancelledEnd,
    'kill "$beater" 2>/dev/null',
    '[ "$code" -eq 0 ] || run_stop',
    'rm -f "$out/one"',
    'printf \'%s\\n\' "$code" > "$out/exit"',
    'printf \'%s\\n\' "$log" > "$out/log"',
    'mv "$out" "$final"',
    'echo "tally: the checks of this landing exited $code; the log is $log" >&2',
    'exit "$code"',
    "",
  ].join("\n");
}
