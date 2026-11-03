# Tally

The tracking harness for parallel agent builds: a ledger of milestones and tasks that is counted from git, a landing protocol for worktree tracks, a status view, and (from Phase 2) a live board and an MCP server. [DESIGN.md](DESIGN.md) is the architecture and the plan; this page is how to run what exists.

**Phase 1 is built, and Example is cut over** (2026-11-03): `@tally/core` and the `tally` command line reach parity with the scripts they replace (`ledger.py`, `status.py`, `land.py` of Example's `.temp/`), its ledger lives in `docs/records/` on `main` (`records: import the progress ledger`), and `scripts/wrappers/` are the drop-in scripts that hand the old command lines to tally (`scripts/cutover_first_repository.py` installed them under the tracks' locks). Nothing is served yet.

## Run

```bash
npm install
npm run build          # tsc -b: packages/*/dist
npm test               # vitest
npm run coverage
node packages/cli/dist/main.js --help
```

A tracked repository gets `docs/records/config.json` and `docs/records/ledger.json` from `tally init`; every other command finds them above the current folder or through `--repo`.

```bash
tally init --config examples/first-repository.config.json --baseline d0ff4a5
tally import board .temp/tracks/board.json
tally status                       # the terminal tables; --markdown, --json
tally task plan B2 --track data "4 manifest and atomic publication" "B2 data close"
tally task land B2 "4 manifest and atomic publication" <commit> [--also <commit>]
tally task wait B2 "B2 data close" "product transcode job"
tally task other <commit> "docs: a note"
tally ledger check                 # commits on main the ledger misses; exit 1 when any
tally land data --message .temp/data/msg.txt crates/acme-core/src/store/manifest.rs
```

`task` verbs write `ledger.json` under a lock and, when `records.commit` is on, commit `docs/records/` as the configured identity with the prefix `records:`; `ledger check` and `status` pass over those commits by their prefix. `land` is `land.py`'s protocol: the operator checkout on `main` and clean outside `docs/records/`, the worktree on its branch, no unrelated staged files, rebase, the configured test command in the worktree, a commit as the configured identity, a fast-forward of `main`, all under `.temp/tally/state/locks/landing.lock`.

## Layout

| path | holds |
| --- | --- |
| `packages/core/src/schema` | the Zod schemas: `config.json`, `ledger.json` |
| `packages/core/src/store` | atomic JSON files, the lock, the records folder |
| `packages/core/src/git` | the few git reads every verb needs |
| `packages/core/src/ledger` | plan, land, wait, other, check, the board import |
| `packages/core/src/status` | the summary, tracks, questions, the tables |
| `packages/core/src/land` | the landing protocol and its refusals |
| `packages/core/src/records` | the records commit |
| `packages/cli/src` | `tally`: argument parsing and one file per command |
| `packages/*/tests` | Vitest, mirroring `src`; temp git repositories as fixtures |
| `examples/` | a config per tracked repository |

Rules: files under 400 lines, tests first, no comments in source, immutable updates. Node 24, TypeScript strict, npm workspaces.
