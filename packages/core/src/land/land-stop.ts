import { quoted } from "./runner.ts";

export const CANCELLED_EXIT = 3;
export const GRACE_SECONDS = 10;
export const STOP_LIMIT_SECONDS = 60;

const NO_GROUP = "tally: this check runs in no process group of its own here (no setsid), so only its own process is stopped; what it started may still run";

export function stopFunctions(stop: readonly string[] | undefined): string[] {
  return [
    'cancelled() { [ "$(cat "$owner" 2>/dev/null)" = cancelled ]; }',
    "grouping=no",
    "command -v setsid >/dev/null 2>&1 && grouping=yes",
    "own_group() {",
    '  g="$(ps -o pgid= -p "$$" 2>/dev/null | tr -d " ")"',
    '  if [ -z "$g" ]; then g="$(sed "s/.*) //" "/proc/$$/stat" 2>/dev/null | cut -d " " -f 3)"; fi',
    '  printf "%s" "$g"',
    "}",
    "run_check() {",
    '  rm -f "$out/group" "$out/pid"',
    '  if [ "$grouping" = yes ]; then',
    `    setsid sh -c 'printf "%s\\n" "$$" > "$1/pid"; printf "%s\\n" "$$" > "$1/group"; cd "$2" || exit 1; shift 2; "$@"' tally-check "$out" "$checkout" "$@"`,
    "  else",
    `    sh -c 'printf "%s\\n" "$$" > "$1/pid"; cd "$2" || exit 1; shift 2; exec "$@"' tally-check "$out" "$checkout" "$@"`,
    "  fi",
    "}",
    "stop_check() {",
    '  g="$(cat "$out/group" 2>/dev/null)"',
    '  case "$g" in ""|*[!0-9]*) g="";; esac',
    '  own="$(own_group)"',
    '  if [ -n "$g" ] && [ "$g" -gt 1 ] && [ -n "$own" ] && [ "$g" != "$own" ]; then',
    `    kill -TERM -"$g" 2>/dev/null; sleep ${GRACE_SECONDS}; kill -KILL -"$g" 2>/dev/null`,
    "    return 0",
    "  fi",
    '  p="$(cat "$out/pid" 2>/dev/null)"',
    '  case "$p" in ""|*[!0-9]*) return 0;; esac',
    `  echo ${quoted(NO_GROUP)} >> "$log"`,
    `  kill -TERM "$p" 2>/dev/null; sleep ${GRACE_SECONDS}; kill -KILL "$p" 2>/dev/null`,
    "}",
    "run_stop() {",
    '  [ -e "$final.stopped" ] && return 0',
    '  : > "$final.stopped"',
    ...(stop === undefined
      ? ["  return 0"]
      : [
          '  echo "-- the landing\'s stop command" | tee -a "$log"',
          `  ( cd "$checkout" && exec ${stop.map(quoted).join(" ")} ) >> "$log" 2>&1 &`,
          "  sp=$!",
          `  ( sleep ${STOP_LIMIT_SECONDS}; kill -TERM "$sp" 2>/dev/null ) >/dev/null 2>&1 &`,
          "  wd=$!",
          '  wait "$sp"; st=$?',
          '  kill "$wd" 2>/dev/null',
          '  [ "$st" -eq 0 ] || echo "tally: the landing\'s stop command exited $st" | tee -a "$log" >&2',
        ]),
    "}",
  ];
}

export const beaterLines = (beatSeconds: number): string[] => [
  "( while kill -0 $$ 2>/dev/null; do",
  '    touch "$beat"',
  '    if ! owns && [ ! -e "$out/stopping" ]; then : > "$out/stopping"; stop_check; exit 0; fi',
  `    sleep ${beatSeconds}`,
  "  done ) >/dev/null 2>&1 &",
];

export const cancelledEnd: readonly string[] = [
  "if cancelled; then",
  '  echo "tally: this landing was cancelled at its turn; its checks stopped" | tee -a "$log" >&2',
  "  run_stop",
  '  if [ -e "$out/stopping" ]; then wait "$beater"; else kill "$beater" 2>/dev/null; fi',
  `  exit ${CANCELLED_EXIT}`,
  "fi",
];
