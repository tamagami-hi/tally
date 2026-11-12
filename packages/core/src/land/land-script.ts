import type { Track } from "../schema/config.ts";
import type { Repo } from "../store/records.ts";
import { environmentLines, quoted } from "./runner.ts";

export interface LandScriptInput {
  repo: Repo;
  track: Track;
  tree: string;
  checkout: string;
  commits: readonly string[];
  resultDir: string;
  log: string;
}

const BEAT_SECONDS = 5;

function landingEnvironment({ repo, tree, track }: LandScriptInput): string[] {
  const filled = (value: string): string => value.replaceAll("{worktree}", () => tree).replaceAll("{track}", () => track.name);
  return Object.entries(repo.config.commands.landing?.env ?? {}).map(([name, value]) => `export ${name}=${quoted(filled(value))}`);
}

export function landScript(input: LandScriptInput): string {
  const { repo, track, tree, checkout, commits, resultDir, log } = input;
  const command = (track.test ?? repo.config.commands.test).map(quoted).join(" ");
  const links = (repo.config.commands.landing?.link ?? []).map((path) => `  [ "$one" -ne 0 ] || link ${quoted(path)} >> "$log" 2>&1 || one=1`);
  return [
    "#!/bin/sh",
    "set -u",
    `tree=${quoted(tree)}`,
    `checkout=${quoted(checkout)}`,
    `final=${quoted(resultDir)}`,
    `log=${quoted(log)}`,
    'out="$final.tmp"',
    'beat="$final.beat"',
    'rm -rf "$out"',
    'mkdir -p "$out" "$(dirname "$log")"',
    ': > "$log"',
    'touch "$beat"',
    `( while kill -0 $$ 2>/dev/null; do touch "$beat"; sleep ${BEAT_SECONDS}; done ) >/dev/null 2>&1 &`,
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
    `for commit in ${commits.join(" ")}; do`,
    '  echo "== $(git -C "$checkout" log -1 --format=\'%h %s\' "$commit")" | tee -a "$log"',
    "  one=0",
    '  git -C "$checkout" checkout --quiet --detach --force "$commit" >> "$log" 2>&1 && git -C "$checkout" clean --quiet -fd >> "$log" 2>&1 || one=1',
    ...links,
    '  if [ "$one" -eq 0 ]; then',
    `    { ( cd "$checkout" && ${command} ); echo "$?" > "$out/one"; } 2>&1 | tee -a "$log"`,
    '    one="$(cat "$out/one" 2>/dev/null || echo 1)"',
    "  fi",
    '  echo "$commit $one" >> "$out/commits"',
    '  if [ "$one" -ne 0 ]; then code="$one"; break; fi',
    "done",
    'kill "$beater" 2>/dev/null',
    'rm -f "$out/one"',
    'printf \'%s\\n\' "$code" > "$out/exit"',
    'printf \'%s\\n\' "$log" > "$out/log"',
    'mv "$out" "$final"',
    'echo "tally: the landing\'s checks exited $code; the log is $log" >&2',
    'exit "$code"',
    "",
  ].join("\n");
}
