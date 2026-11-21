# Tally

The tracking harness for parallel agent builds: a ledger of milestones and tasks that is counted from git, a landing protocol for worktree tracks, a status view, and (from Phase 2) a live board and an MCP server. [DESIGN.md](DESIGN.md) is the architecture and the plan; this page is how to run what exists.

**Phase 1 is built, and the first repository is cut over** (2026-11-03): `@tally/core` and the `tally` command line reach parity with the scripts they replace (a `ledger.py` over a `board.json`, a `status.py`, a `land.py`), that repository's ledger lives in its `docs/records/` on `main` (`records: import the progress ledger`), and `scripts/wrappers/` are the drop-in scripts that hand the old command lines to tally (`scripts/cutover_from_board.py` installs them under the old scripts' locks). Nothing is served yet.

## Run

```bash
npm install
npm run build          # the web build, tsc -b (packages/*/dist), then the build stamp
npm test               # vitest
npm run coverage
npm run smoke          # the built tally mcp on a scratch repository, on 2025-03-26 and on 2026-07-28; exit 1 on a failure
node packages/cli/dist/main.js --help
node packages/cli/dist/main.js version   # the source's version and the build's; exit 1 when the build is older
node packages/cli/dist/main.js usage     # the tools by calls since counting began, and those never called
```

`npm run build` ends by writing `packages/cli/dist/build.json`, the version the build was made at. A command run from a build whose stamp names another version than its source, or that has none, says so in one line on the error stream and otherwise does what it would have done.

A tracked repository gets `docs/records/config.json` and `docs/records/ledger.json` from `tally init`; every other command finds them above the current folder or through `--repo`.

## Run as a service

**Phases 5, 6 and 7 are built** (2026-11-12, [DESIGN.md](DESIGN.md) §14 to §16): one Docker service for every repository, the tools agents need to work in parallel, and context kept as JSON records. The MCP server has 62 tools. [GUIDE.md](GUIDE.md), section 10, is how an agent works through it.

**0.7.0** (2026-11-21, [DESIGN.md](DESIGN.md) §23): a repository's work runs in numbered cycles, closed on the operator's word (`cycle_close`) and read back with `cycle`; milestones and tracks can be edited (`milestone_edit`, `milestone_remove`, `track_edit`); the service watches every listed repository from its start and survives a bad file, a hung git or a lost lock; each repository has its own MCP address, `/r/<name>/mcp`; and tally counts the calls each tool receives (`tally usage`, `/api/usage`). The MCP server has 72 tools, 71 where the service runs no command, and `tools/list` stays under 77,000 characters.

**0.8.0** (2026-11-21, [DESIGN.md](DESIGN.md) §24): an operator session records a decision or an answer over MCP with the operator's own words (`decision_record`, `decision_status`, `question_answer`), and the operator confirms it on the board; a decision says what makes it built and which paths it governs, and a task cites the records it is built to; a track session opens with its work order (`brief: "order"`), the cited records word for word; `covering` answers what covers a diff's files; and a builder and a reviewer each have their own MCP address with their own tools (`/mcp/builder`, `/mcp/reviewer`). The MCP server has 76 tools, 75 where the service runs no command; `tools/list` stays under 77,000 characters, the builder's under 30,000 and the reviewer's under 22,000.

**0.9.1** (2026-11-21, [DESIGN.md](DESIGN.md) §25): a landing checks each commit with the checks its own files choose, or its tip only when asked, and can be cancelled at its turn; a person's check on a device is recorded with `evidence_manual`; releases are marked and their tasks counted (`release_mark`, `release_list`); an operator checks several lanes together in a trial tree before any lands (`trial_start`, `trial_end`); and hints name the oldest open question, the work built on a question's meanwhile and an order for landings. The fix round after it keeps a dispute from vanishing, marks unconfirmed and disputed decisions for builders, and groups what closed lanes kept by cycle. The MCP server has 81 tools, 80 where the service runs no command; `tools/list` stays under 80,000 characters for this release, the builder's under 30,000 and the reviewer's under 22,000.

```bash
cp .env.example .env        # your uid and gid, the workspace folder, your git config
docker compose up -d --build
```

- **The board** is `http://127.0.0.1:47560/`. The sidebar lists the repositories. "Add repository" opens a folder picker over the workspace. A git repository with no records gets a default config and an empty ledger, committed as `records: start tracking`.
- **Agents** connect to one URL, registered once: `http://127.0.0.1:47560/mcp` (streamable HTTP). For Claude Code: `claude mcp add --transport http --scope user tally http://127.0.0.1:47560/mcp`.
- **A session** begins with `session_open({worktree, agent})`. The folder is enough: tally finds the repository and the track. The answer names `runner`, a script in the worktree.
- **A check** is run by the agent, in its own shell, where the toolchain is: `.temp/tally/run green --task "M1:the task" -- npm test`. The script keeps the log, and the service takes the result in as a run record within two seconds.
- **A landing** is `land_start({sessionId, files, message, milestone?, task?})`, which answers a ticket. When its state is `turn`, run the command in `run`, then call `land_wait`. Tally commits the named files, rebases in a clean checkout, and fast-forwards `main` once every commit's checks have passed. A failure changes nothing on `main`.
- **Parallel work.** Agents open and close tracks themselves (`track_open`, `track_close`), are told when another track has changed the same file, leave each other notes, and get what is new for them in every tool answer under `inbox`.
- **Context** is JSON records under `docs/records/context/`, read with `context_get` and written with `context_put`. A session's brief arrives with `session_open`.
- **Each repository is separate.** A session reads and writes only its own repository's records, state and logs.

The service listens on the host's loopback only and refuses a request from another host or another site's page. The container has git and Node and no other toolchain: it never runs a repository's commands. Its image sets `TALLY_COMMANDS=agent`, so `evidence_run` answers the runner line to run instead and `land_run` is not listed (land with `land_start`); on the host the variable is unset and both run as before.

The image builds its own git (2.56.1) from kernel.org's source, because a repository can use a format extension that only a newer git reads. If adding a repository fails with `unknown repository extension found`, the git on your machine is newer than the image's: raise `GIT_VERSION` and `GIT_SHA256` in the [Dockerfile](Dockerfile) and rebuild.

- **The `tally` command** is carried out by the service when `TALLY_URL` is set, for example `export TALLY_URL=http://127.0.0.1:47560`. Then the service is the only writer, and a script's `tally land` goes through the same queue as the agents' landings. With `TALLY_URL` unset, `tally` works on the files itself, which is for a repository the service doesn't serve.

Without Docker, `tally serve` with no `--repo` serves the same list from `TALLY_HOME` (by default `~/.local/state/tally`), and `tally repo add PATH [--name NAME] | remove NAME | default NAME | list` manages it.

**Phase 4 is built** (2026-11-04): the records. `docs/records/` now holds, beside the ledger and the config, `decisions.json` and `questions.json` (imported from the Markdown tables; `tally question add|answer`, `tally decision add|replace --operator`, `decision setStatus`, each with `--state`), `checks.json` (the code-check record, imported from `code-checks.md` and replaced whole with `tally checks set`, refused unless its fingerprint is main's; `checks fingerprint` says whether it stands), `buildlog.json` (every group's build log as dated sections, imported, appended to and rendered back), `evidence/<milestone>.json` (run records, with `tally import evidence` indexing a track's existing `*.json` + `*.log` pairs, the logs hashed in place), `plans.json` and `reports/<date>/<name>.json` manifests that cite records by id and hash a bundle. Every import refuses a file that does not render back byte for byte. `tally views claude` writes CLAUDE.md's standing block between `tally:standing` markers. The MCP server has 35 tools, and the board's Evidence page lists each milestone's run records with their logs opened in place.

**Phase 3 is built:** the MCP server. `tally mcp` serves 25 tools on stdio and `tally serve` the same at `/mcp`: sessions bound to a worktree and a track (`session_open`), the board and the ledger verbs with scope (`board_get`, `task_plan|claim|release|wait|land|other`, `milestone_add`, `ledger_check`), the landing (`land_run`), evidence (`evidence_run|record|list`), hand-offs, named locks, the documents (`docs_list|read|search`) and `context_pack` at the project, track, milestone or task level. [GUIDE.md](GUIDE.md) says how to connect Claude Code or Kiro and how a session works; [RULES.md](RULES.md) is what the harness enforces. The board shows who is working, what they hold and which locks are taken.

**Phase 2 is built:** `tally serve` runs the live board at `http://127.0.0.1:47560/`: the ledger, the tracks' worktrees and the commit graph, pushed over server-sent events as git or the ledger changes (a 2 s fingerprint poll of refs, working trees and `ledger.json`). The page has two layouts, chosen by orientation: three panels side by side on a 16:9 screen, one page at a time with a bottom tab bar on a 9:16 phone. Light and dark follow the system and can be switched. The Evidence page lists each milestone's run records per task and opens a log in place (`/api/evidence`, `/api/evidence/<milestone>`, `/api/evidence/log/<id>`, which says whether the log still matches its hash). The API: `GET /api/snapshot | /api/status | /api/graph | /api/ledger | /api/config` (env values redacted) and `GET /events`.

```bash
tally init --config examples/three-tracks.config.json --baseline <first commit>
tally import board .temp/tracks/board.json   # or: scripts/cutover_from_board.py --repo . --config <file>
tally status                       # the terminal tables; --markdown, --json
tally task plan B2 --track data "4 manifest and atomic publication" "B2 data close"
tally task land B2 "4 manifest and atomic publication" <commit> [--also <commit>]
tally task wait B2 "B2 data close" "product transcode job"
tally task remove B2 "9 planned by mistake" --why "it is covered by task 4"
tally task other <commit> "docs: a note"
tally ledger check                 # commits on main the ledger misses; exit 1 when any (records-only commits are passed over, and counted)
tally land data --message .temp/data/msg.txt crates/acme-core/src/store/manifest.rs
tally import decisions docs/plans/decisions.md --group platform   # also questions, checks, buildlog --group G
tally import evidence .temp/worktrees/data/.temp/data/B2/task3 --milestone B2 --task "3 source grid"
tally checks fingerprint           # record vs main; exit 1 when stale
tally buildlog append --group market_data --milestone B2 --title "The replay store" --date 2026-11-05 --file body.md
tally decision setStatus SID-3 --group market_data --status "built in A2 (321ec32)"
tally report manifest 2026-11-03 b4-data --group market_data --narrative docs/market_data/reports/2026-11-03/b4-data.md --bundle docs/market_data/reports/2026-11-03/b4-data --evidence "B4:data review fixes D1-D3"
tally views claude --check         # CLAUDE.md's standing block; exit 1 when stale
```

`task` verbs write `ledger.json` under a lock and, when `records.commit` is on, commit `docs/records/` as the configured identity with the prefix `records:`; `ledger check` and `status` pass over those commits by their prefix, and over any commit that changes only files under `docs/records/`. `land` is `land.py`'s protocol: the operator checkout on `main` and clean outside `docs/records/`, the worktree on its branch, no unrelated staged files, rebase, the configured test command in the worktree, a commit as the configured identity, a fast-forward of `main`, all under `.temp/tally/state/locks/landing.lock`. With `commands.landing` in the config the tests see only what lands: the commit comes first, and every commit ahead of `main` is tested, oldest first, in a detached checkout at `<worktree>/.temp/<track>/landing`. A failure names the commit and the log, leaves `main` alone and undoes the landing's own commit with `git reset --soft`, its files left staged. [GUIDE.md](GUIDE.md), section 7, has `link` and `env`.

## Evaluating the MCP server

`evaluations/tally.xml` holds eighteen questions an agent should be able to answer with the read-only tools, each with one checked answer. They are asked about a small repository that `evaluations/fixture.py` builds the same way every time:

```bash
python3 evaluations/fixture.py /tmp/lumen
```

Then run an MCP evaluation harness over stdio against `node packages/cli/dist/main.js --repo /tmp/lumen mcp`. The questions follow the format of the evaluation script in Anthropic's `mcp-builder` skill.

## Layout

| path | holds |
| --- | --- |
| `packages/core/src/schema` | the Zod schemas: `config.json`, `ledger.json` |
| `packages/core/src/store` | atomic JSON files, the lock, the records folder |
| `packages/core/src/git` | the few git reads every verb needs |
| `packages/core/src/ledger` | plan, land, wait, other, the check and what main still owes it, the board import |
| `packages/core/src/status` | the summary (with each milestone's `finished`), tracks, questions, the tables |
| `packages/core/src/done` | the Done answer: closed phases, finished milestones and landed tasks with their dates, and the ended sessions read back from the activity log |
| `packages/core/src/land` | the landing protocol and its refusals, the clean checkout, the tests' log |
| `packages/core/src/records` | the records commit; decisions, questions, checks, build logs, evidence (and the index of existing run records), checks made by hand, plans, report manifests, hand-offs |
| `packages/core/src/releases` | releases: the file, the mark, the tasks each holds, a cycle's releases |
| `packages/core/src/trials` | the trial tree: its record, its start, its end and what it removes |
| `packages/core/src/views` | the standing block CLAUDE.md carries between its markers |
| `packages/server/src` | Hono: the API, the event stream, the git watcher, the commit graph layout, static serving of the web build |
| `packages/web/src` | Vite + React, hand-written CSS: the board (`Shell`, `Header`, `Stats`, `Board` of open work, `Tracks`, `Graph`, `Done` with `DonePhases` and `DoneSessions`, `Evidence` with its logs, `Docs` with its reader), what the board shows (`open.ts`), the fork lanes (`lanes.ts`), the branch colours and ranks (`branches.ts`), the live hooks, the two layouts in `styles.css` and Done's in `done.css` |
| `packages/cli/src` | `tally`: argument parsing, one file per command, the activity event a decision or question write leaves, and the build stamp that `tally version` and the stale-build warning read |
| `packages/*/tests` | Vitest, mirroring `src`; temp git repositories as fixtures |
| `examples/` | a config per tracked repository |

Rules: files under 400 lines, tests first, no comments in source, immutable updates. Node 24, TypeScript strict, npm workspaces.
