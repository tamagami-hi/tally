# Tally

The tracking harness for parallel agent builds: a ledger of milestones and tasks that is counted from git, a landing protocol for worktree tracks, a status view, and (from Phase 2) a live board and an MCP server. [DESIGN.md](DESIGN.md) is the architecture and the plan; this page is how to run what exists.

**Phase 1 is built, and the first repository is cut over** (2026-11-03): `@tally/core` and the `tally` command line reach parity with the scripts they replace (a `ledger.py` over a `board.json`, a `status.py`, a `land.py`), that repository's ledger lives in its `docs/records/` on `main` (`records: import the progress ledger`), and `scripts/wrappers/` are the drop-in scripts that hand the old command lines to tally (`scripts/cutover_from_board.py` installs them under the old scripts' locks). Nothing is served yet.

## Run

```bash
npm install
npm run build          # tsc -b: packages/*/dist
npm test               # vitest
npm run coverage
node packages/cli/dist/main.js --help
```

A tracked repository gets `docs/records/config.json` and `docs/records/ledger.json` from `tally init`; every other command finds them above the current folder or through `--repo`.

**Phase 4 is built** (2026-11-04): the records. `docs/records/` now holds, beside the ledger and the config, `decisions.json` and `questions.json` (imported from the Markdown tables; `tally question add|answer`, `tally decision add|replace --operator`, `decision setStatus`), `checks.json` (the code-check record, imported from `code-checks.md` and replaced whole with `tally checks set`, refused unless its fingerprint is main's; `checks fingerprint` says whether it stands), `buildlog.json` (every group's build log as dated sections, imported, appended to and rendered back), `evidence/<milestone>.json` (run records, with `tally import evidence` indexing a track's existing `*.json` + `*.log` pairs, the logs hashed in place), `plans.json` and `reports/<date>/<name>.json` manifests that cite records by id and hash a bundle. Every import refuses a file that does not render back byte for byte. `tally views claude` writes CLAUDE.md's standing block between `tally:standing` markers. The MCP server has 35 tools, and the board's Evidence page lists each milestone's run records with their logs opened in place.

**Phase 3 is built:** the MCP server. `tally mcp` serves 25 tools on stdio and `tally serve` the same at `/mcp`: sessions bound to a worktree and a track (`session_open`), the board and the ledger verbs with scope (`board_get`, `task_plan|claim|release|wait|land|other`, `milestone_add`, `ledger_check`), the landing (`land_run`), evidence (`evidence_run|record|list`), hand-offs, named locks, the documents (`docs_list|read|search`) and `context_pack` at the project, track, milestone or task level. [GUIDE.md](GUIDE.md) says how to connect Claude Code or Kiro and how a session works; [RULES.md](RULES.md) is what the harness enforces. The board shows who is working, what they hold and which locks are taken.

**Phase 2 is built:** `tally serve` runs the live board at `http://127.0.0.1:47560/`: the ledger, the tracks' worktrees and the commit graph, pushed over server-sent events as git or the ledger changes (a 2 s fingerprint poll of refs, working trees and `ledger.json`). The page has two layouts, chosen by orientation: three panels side by side on a 16:9 screen, one page at a time with a bottom tab bar on a 9:16 phone. Light and dark follow the system and can be switched. The Evidence page lists each milestone's run records per task and opens a log in place (`/api/evidence`, `/api/evidence/<milestone>`, `/api/evidence/log/<id>`, which says whether the log still matches its hash). The API: `GET /api/snapshot | /api/status | /api/graph | /api/ledger | /api/config` (env values redacted) and `GET /events`.

```bash
tally init --config examples/three-tracks.config.json --baseline <first commit>
tally import board .temp/tracks/board.json   # or: scripts/cutover_from_board.py --repo . --config <file>
tally status                       # the terminal tables; --markdown, --json
tally task plan B2 --track data "4 manifest and atomic publication" "B2 data close"
tally task land B2 "4 manifest and atomic publication" <commit> [--also <commit>]
tally task wait B2 "B2 data close" "product transcode job"
tally task other <commit> "docs: a note"
tally ledger check                 # commits on main the ledger misses; exit 1 when any
tally land data --message .temp/data/msg.txt crates/acme-core/src/store/manifest.rs
tally import decisions docs/plans/decisions.md --group platform   # also questions, checks, buildlog --group G
tally import evidence .temp/worktrees/data/.temp/data/B2/task3 --milestone B2 --task "3 source grid"
tally checks fingerprint           # record vs main; exit 1 when stale
tally buildlog append --group market_data --milestone B2 --title "The replay store" --date 2026-11-05 --file body.md
tally decision setStatus SID-3 --group market_data --status "built in A2 (321ec32)"
tally report manifest 2026-11-03 b4-data --group market_data --narrative docs/market_data/reports/2026-11-03/b4-data.md --bundle docs/market_data/reports/2026-11-03/b4-data --evidence "B4:data review fixes D1-D3"
tally views claude --check         # CLAUDE.md's standing block; exit 1 when stale
```

`task` verbs write `ledger.json` under a lock and, when `records.commit` is on, commit `docs/records/` as the configured identity with the prefix `records:`; `ledger check` and `status` pass over those commits by their prefix. `land` is `land.py`'s protocol: the operator checkout on `main` and clean outside `docs/records/`, the worktree on its branch, no unrelated staged files, rebase, the configured test command in the worktree, a commit as the configured identity, a fast-forward of `main`, all under `.temp/tally/state/locks/landing.lock`. With `commands.landing` in the config the tests see only what lands: the commit comes first, and every commit ahead of `main` is tested, oldest first, in a detached checkout at `<worktree>/.temp/<track>/landing`. A failure names the commit and the log, leaves `main` alone and undoes the landing's own commit with `git reset --soft`, its files left staged. [GUIDE.md](GUIDE.md), section 7, has `link` and `env`.

## Layout

| path | holds |
| --- | --- |
| `packages/core/src/schema` | the Zod schemas: `config.json`, `ledger.json` |
| `packages/core/src/store` | atomic JSON files, the lock, the records folder |
| `packages/core/src/git` | the few git reads every verb needs |
| `packages/core/src/ledger` | plan, land, wait, other, check, the board import |
| `packages/core/src/status` | the summary, tracks, questions, the tables |
| `packages/core/src/land` | the landing protocol and its refusals, the clean checkout, the tests' log |
| `packages/core/src/records` | the records commit; decisions, questions, checks, build logs, evidence (and the index of existing run records), plans, report manifests, hand-offs |
| `packages/core/src/views` | the standing block CLAUDE.md carries between its markers |
| `packages/server/src` | Hono: the API, the event stream, the git watcher, the commit graph layout, static serving of the web build |
| `packages/web/src` | Vite + React, hand-written CSS: the board (`Shell`, `Header`, `Stats`, `Board`, `Tracks`, `Graph`, `Evidence` with its logs, `Docs` with its reader), the fork lanes (`lanes.ts`), the branch colours and ranks (`branches.ts`), the live hook, the two layouts in `styles.css` |
| `packages/cli/src` | `tally`: argument parsing and one file per command |
| `packages/*/tests` | Vitest, mirroring `src`; temp git repositories as fixtures |
| `examples/` | a config per tracked repository |

Rules: files under 400 lines, tests first, no comments in source, immutable updates. Node 24, TypeScript strict, npm workspaces.
