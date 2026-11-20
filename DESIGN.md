# Tally: the tracking harness, design

**Status: proposed and approved 2026-11-03 (every recommendation of §12 as written); Phase 1 is built and the first tracked repository was cut over the same day.** This copy names no project: that repository keeps its own copy of the design with its names, paths and locks beside its tracking notes. `tally` is a working name; change it anywhere. **§14 to §18 were approved on 2026-11-12, with every recommendation of §18 as written: one Docker service for many repositories, the agents' improvements, and context as JSON records. None of it is built.**

Tally is one service, written in TypeScript, that holds everything `docs/` is responsible for as records agents read and write through an MCP server and a CLI, shows the whole build live in the browser, and hands each agent session exactly the context its level needs. The code lives outside the repository it tracks (`.temp/tally/` now, its own repository later); the records live inside the tracked repository, under `docs/records/`, as JSON files git keeps.

## 1. Why: what exists today, and where the copies are

Tracking today is spread over five places, each with its own format, and each fact is copied into most of them.

| Where | What | Form | Writer |
| --- | --- | --- | --- |
| `.temp/tracks/board.json` | the progress ledger: milestones, tasks, the commit that landed each, waits | JSON, one file, `flock` | `ledger.py plan/land/wait/other/check` |
| `.temp/tracks/status*.py` | the status: progress bars, tracks, commit graph, open questions | Python → terminal, markdown, or `status.html` + `status-data.js` rewritten every second | the operator, by hand |
| a resume folder's `land.py` | the landing: rebase, `cargo test --locked`, commit with the operator's identity, `--ff-only`, under `landing.lock` | Python | each track |
| `.temp/tracks/track-rules.md` and the resume folder's notes | the operator's standing instructions and hand-off notes | Markdown, 17k + 15k | the operator, orchestrators |
| `.temp/worktrees/<t>/.temp/<t>/` | per-milestone task lists, verification notes, reviews, fixes, follow-ups, open items; per-task `red/green/clippy/fmt/land` run records (`*.json`: command, cwd, started, seconds, exit; `*.log`) | 4,733 files, 81 MB, three conventions | each track's steps |
| `docs/` (git) | decisions (3 files), questions (3), build logs (3), `code-checks.md`, plans with status lines, `README.md`s with status columns, `reports/<date>/` | 47 Markdown files, 5 MB, of which 3.7 MB is one evidence bundle of 195 copied logs | each track's docs commit, by §4 of parallel-build |

**The same fact has up to nine homes.** A milestone part's "built" is written in CLAUDE.md, `docs/README.md`, the build order's status line, the architecture plan's status line, the plan's own status line, the decisions file's status column, the build log, the hand-off note and the ledger. A test count appears in the run record, the verification note, the review, the fixes note, the commit body, the build log, `code-checks.md` and CLAUDE.md. Evidence is kept raw under `.temp/`, then copied whole into `docs/.../reports/` at the close. Every copy is a read for the next agent and a place to drift.

**What already works, and is kept:** the ledger's shape (milestone → task → commit, `also`, `waits`), the run record's shape (`command, cwd, started, seconds, exit`, which every track already writes), the review's shape (`verdict, findings[{severity, file, line, summary, fix}]`), the landing protocol, the locks (`landing`, `checks`, `evidence`, `board.json`), the status page's layout, and the rule that progress is counted from one ledger only.

## 2. Principles

1. **One home per fact.** A fact is a record, stored once, in `docs/records/`. Every other appearance is a *view*, computed when asked: the status page, CLAUDE.md's standing block, a plan's status, a build log rendered as Markdown, a report's index.
2. **Records are JSON; prose is Markdown** (until Phase 7: §16 makes context JSON records too, and no Markdown file is read as context)**.** Decisions, questions, the ledger, checks, build-log entries, reviews, run records, hand-offs and report manifests are records. RULES.md, CLAUDE.md, the READMEs, the plans, the references, the manuals and a report's narrative stay Markdown, served and searched by the harness, never parsed into it.
3. **Hierarchy, not copies.** project → stage → milestone → track → task → attempt. A session asks for the context of its level; the pack is assembled from the homes at that moment, never stored.
4. **Scoped by worktree.** A session binds to one worktree and one track. It writes only its track's tasks and evidence; it reads everything.
5. **Git is the history.** The server is the live view and the only writer of `docs/records/`; it commits the records it changes. No database.
6. **Logs stay where they fall; records point at them.** A run's log is kept in the track's `.temp/` with its SHA-256 in the record. A close bundles the logs a report cites, once, by record id, into `docs/<group>/reports/<date>/`.
7. **The harness is repository-agnostic.** Everything about the tracked repository (tracks, worktree root, groups, the test command, the fingerprint paths, the lock names) is in `docs/records/config.json`. A second repository gets its own.
8. **Never:** push, deploy, read a `.env`, touch an archive, delete a `.temp/` folder, rewrite `main`. The harness inherits the tracked repository's rules 1 to 4 and 8 and adds none of its own powers.

## 3. The shape

```
                 browser (live board, docs, evidence)          agent sessions (Claude Code, Kiro)
                            │  HTTP + SSE                              │  MCP (streamable HTTP; stdio shim)
                            └──────────────────┬───────────────────────┘
                                               │
                                     tally serve  (one process per tracked repository, loopback; one container for every listed repository from §14)
                                     ┌─────────┴──────────┐
                                     │ store   records     │  reads/writes docs/records/*.json, atomic, one writer
                                     │ git     watcher     │  refs, worktrees, dirty files, graph; polled every 2 s
                                     │ scope   sessions    │  worktree ⇄ track binding, claims, live state (.temp)
                                     │ land    protocol    │  rebase → test → commit → ff → record → records commit
                                     │ locks   named       │  landing, checks, evidence, …; held by a session
                                     │ views   renderers   │  status, CLAUDE block, build log md, report index
                                     └────────────────────┘
                                               │
                        <repo>/docs/records/*.json (git)      <repo>/.temp/tally/state/  (runtime, not git; the service's data folder from §14.4)
                        <repo>/.temp/worktrees/<track>/.temp/<track>/… (logs, as today)
```

**Packages** (one npm workspace, TypeScript strict, Node 24, Vitest):

| package | holds |
| --- | --- |
| `core` | the Zod schemas of every record (one source for files, API and MCP inputs), the store (read, validate, write atomically, commit), the git reader, the scope rules, the landing and lock protocols, the view renderers |
| `server` | Hono: HTTP API, SSE `/events`, the MCP server (`@modelcontextprotocol/sdk`, streamable HTTP), static serving of `web` |
| `cli` | `tally`: every verb of the MCP surface for scripts and humans, `tally status` (the terminal tables `status.py` prints today), `tally serve`, `tally init`, `tally import` |
| `web` | Vite + React + TanStack Query: the pages of §7 |
| `shim` | `tally-mcp-stdio`: a stdio MCP client-to-HTTP bridge for agents that cannot speak HTTP MCP |

## 4. The records (`docs/records/`)

Every file carries `"schema": 1`. A reader refuses another major version; a field is added in one release and removed only after the readers tolerate its absence (the tracked repository's rule 9, applied to the harness).

| file | record | replaces |
| --- | --- | --- |
| `config.json` | the repository's shape: `tracks[{name, worktree, branch}]`, `worktreeRoot`, `groups[]`, `stages[{id, name, weight}]`, `commands{test, sweep[]}`, `fingerprint{paths, exclude}`, `locks[]`, `identity{name, email}`, `recordsCommitPrefix` | the constants in `ledger.py`, `status.py`, `land.py`, `track-rules.md` |
| `ledger.json` | `milestones[{id, stage, group, name, track, weight, built?, tasks[{id, track, status: planned|claimed|landed, commit?, also[], waits?, claimedBy?, since}]}]`, `other[{commit, note}]`, `baseline` | `board.json` |
| `decisions.json` | `[{id, group, text, since, by: operator|build, status: {kind: decided|partly|inForce|open, refs[], note}, replaced?: {date, by, why, was}}]` | the three `decisions.md` |
| `questions.json` | `[{row, group, question, meanwhile, asked, answered?: {date, decision}}]`, `nextRow` | the three `questions.md`, every "the next row is N" sentence |
| `buildlog.json` | `[{group, milestone, date, commits[], built, verified[{what, command, numbers}], decided[], corrected[], open[]}]` | the three `build-log.md` (imported as `{markdown}` blobs first, structured from the next entry on) |
| `checks.json` | `{fingerprint, fingerprintFull, verifiedBy, recorded, checks[{name, result, command, log?}], suites[{name, count, coverage}], modules[{name, files[], tests[], entryPoints[], gaps[]}]}` | `code-checks.md` |
| `reviews/<milestone>-<track>.json` | `{verdict, at, head, findings[…]}`, plus `fixes[{finding, commit}]`, `followup`, `open[]` | `<M>-review.json/md`, `-fixes.md`, `-followup.md`, `-open.md` |
| `evidence/<milestone>.json` | run records: `[{id, task, track, kind: red|green|clippy|fmt|sweep|coverage|land|evidence, command, cwd, started, seconds, exit, log: {path, sha256, bytes}, summary?: {passed, failed, ignored, …}, note?}]` | every `*.json` + `*.log` pair under `.temp/<track>/` (the logs stay) |
| `handoffs/<track>.json` | `{current: {task, from, at, lines[]}, history[]}`, at most about 60 lines each | the resume notes, `checkpoint.md`, `proof.md` |
| `plans.json` | `[{path, group, milestones[], status: next|completed, movedAt?}]` | every plan's status line and `docs/README.md`'s status column |
| `reports/<date>/<name>.json` | a report's manifest: the records it cites by id, the logs it bundled with their hashes, the narrative's path | `reports/<date>/<name>/README.md` indexes and the copied logs |

(Built in Phase 4, 2026-11-04, with these shapes: `decisions.json` keeps each imported row's `status` text with a derived `state`, and `by` and `on` on a row entered or changed through tally; `questions.json` keeps `open`, `answered` and `nextRow`; `buildlog.json` holds `{group, milestone, title, date, markdown}` sections with each group's preamble, so a group renders back byte for byte, and `commits[]` is optional; `checks.json` keeps the fingerprint rows and the command, the checks, the suites, and each module's file table with its prose as `body`, from which `tests`, `entryPoints` and `gaps` are indexed; an evidence record carries `agent` and a stable id, and `tally import evidence` indexes a track's existing `*.json` + `*.log` pairs with the kind read from the file name; `plans.json` rows are `{path, group, status, title, statusLine}`; a report manifest is `{date, name, group, narrative, fingerprint?, cites{evidence, decisions, questions}, bundled[{path, sha256, bytes}]}`. Reviews stay in the tracks' `.temp/` for now. The CLAUDE block sits between `<!-- tally:standing -->` and `<!-- /tally:standing -->` and is a function of the records alone.)

Runtime state that is not history lives outside git in `.temp/tally/state/`: open sessions, who holds which lock, the last git snapshot, the SSE replay buffer. (Under §14.4, each repository's state moves to the service's data folder.)

## 5. Hierarchy and scope

```
project (one config)
└── stage A/B/C (weights)
    └── milestone (group, weight, built?)
        └── task (one track, one commit when landed; waits; claimedBy)
            └── attempt (run records: red, green, clippy, fmt, land …)
tracks ──── worktree ──── sessions (an agent, a model, a start time, a current task)
```

- **Binding.** `session.open({worktree, track, agent})` checks that the path is a git worktree of the repository and that its branch is the track's; it answers a session id. Every later call carries it. A call that writes to another track's task, evidence or hand-off is refused. Reads are unscoped (`scope: mine | all`).
- **Claims.** `task.claim` marks the task `claimed` by the session and shows it live; `task.release` undoes it; a landing clears it. One task claimed per session.
- **Context packs.** `context.pack({level})` assembles, from the homes, exactly what a session at that level reads at its start, and nothing it can find in the commits:
  - **L0 project:** RULES.md, CLAUDE.md (its static part), the config, the open questions.
  - **L1 track:** its worktree and branch, its tasks (planned, claimed, waiting), the shared files it may edit and when (the repository's parallel-build plan §4, as records), its current hand-off.
  - **L2 milestone:** the plan paths and §s the milestone names, its task list, the review checklist (Delivers, Tests, Evidence mapped to tasks), its evidence so far.
  - **L3 task:** the task, the files it touches, the tests written first, its attempts, what it waits on.
  Each pack is a view: assembled on request, never saved, so there is nothing to drift.

## 6. The tools (MCP and CLI, one surface)

Every verb exists twice with the same name and arguments: an MCP tool for agents, a `tally <verb>` command for scripts and humans. (Built in Phase 3, 2026-11-04: the MCP tools are spelled with underscores, `session_open`, `task_claim`, since tool names may not carry dots; claims live in the runtime state, not in `ledger.json`'s `claimedBy`, so a claim never makes a records commit; and the stdio shim is the server itself on stdio, `tally mcp`, sharing the live state through files with `tally serve`.) Inputs are the Zod schemas of `core`; errors name the record and the rule.

| group | verbs | notes |
| --- | --- | --- |
| session | `session.open`, `session.close`, `session.list` | binding (§5) |
| board | `board.get({scope})`, `board.status()` | the status page's data; `tally status` prints the tables |
| task | `task.plan(milestone, track, tasks[])`, `task.claim`, `task.release`, `task.wait(what)`, `task.land(commit, also[])`, `task.other(commit, note)`, `ledger.check()` | `ledger.py`'s verbs, scoped; `land` records only (the landing itself is below) |
| land | `land.run({files[], messageFile, verifiedCode?})` | `land.py`: rebase, test, commit with the configured identity, `--ff-only`, then `task.land`, then the records commit, all under the `landing` lock; refuses what `land.py` refuses |
| evidence | `evidence.record({task, kind, command, cwd, started, seconds, exit, logPath, summary?})`, `evidence.run({task, kind, command})`, `evidence.list({task})`, `evidence.bundle({report, ids[]})` | `run` executes the command in the session's worktree with the configured environment and records it, so a track writes no runner of its own; `bundle` copies the cited logs once into the report's folder with their hashes |
| decision | `decision.list`, `decision.add`, `decision.replace`, `decision.setStatus` | `add` and `replace` are the operator's: the record carries `by: operator` and the CLI asks for `--operator`; a session records, never decides |
| question | `question.list`, `question.add({group, question, meanwhile})`, `question.answer({row, decision})` | `add` takes the next row under the lock, so two tracks never take one number |
| buildlog | `buildlog.append`, `buildlog.render({group})` | `render` gives the Markdown a reader would have read in `build-log.md` |
| checks | `checks.get`, `checks.set({…})`, `checks.fingerprint()` | `set` refuses a fingerprint that is not what `git log` prints for the config's paths at `main`; `fingerprint` answers whether the record stands |
| review | `review.submit`, `review.fixes`, `review.followup` | one review per milestone per track |
| handoff | `handoff.write({lines[]})`, `handoff.read({track})` | at most about 60 lines; the previous one moves to history |
| locks | `lock.acquire(name, note)`, `lock.release(name)`, `lock.list` | `landing`, `checks`, `evidence`, …; a lock dies with its session |
| docs | `docs.read(path)`, `docs.search(query)`, `docs.list` | Markdown and records, read-only; paths are inside `docs/`, RULES.md, CLAUDE.md, README.md |
| context | `context.pack({level, milestone?, task?})` | §5 |
| views | `views.claude()`, `views.readme()`, `views.plan(path)` | the generated blocks (§8) |

**HTTP** mirrors the same verbs under `/api/<group>/<verb>` (JSON in, JSON out), plus `GET /events` (SSE: `ledger`, `evidence`, `git`, `session`, `lock` events, with `Last-Event-ID` replay) and `GET /docs/*` for rendered Markdown.

## 7. The web

One page, routed, served by `tally serve` at `http://127.0.0.1:47560/` (a free port in the operator's 475xx range; the config may change it), live over SSE, the status page's current layout kept where it is good.

| page | shows |
| --- | --- |
| **Board** | the stage bars, every milestone's tasks with who holds each (claimed, by which session, since when), waits as arrows to what they wait on, `ledger.check`'s problems |
| **Tracks** | each worktree: branch, HEAD, ahead/behind `main`, dirty files with +/−, the claimed task, the last evidence record, the locks it holds, the session on it |
| **Graph** | the commit graph of `main` and the tracks, as `status_html.py` draws it |
| **Evidence** | per milestone and task: the attempts in order, red before green, command, exit, seconds, summary; the log opened in place from its path |
| **Reviews** | verdicts, findings, fixes, follow-ups, what is open |
| **Decisions / Questions** | the records as tables, filtered by group; a question's meanwhile beside it; the next row |
| **Checks** | the code-check record: whether its fingerprint stands against `main` now, suites, coverage, modules and gaps |
| **Docs** | RULES.md, CLAUDE.md, the READMEs, the plans, the references, the manuals, rendered with working links; the build logs rendered from records; search |
| **Guide** | how to use the harness (§10), rendered from its own repository |

## 8. The views that replace copies

| today | becomes |
| --- | --- |
| CLAUDE.md "Where the project stands", "Open questions" | a block between `<!-- tally:standing -->` markers, written by `views.claude()` at each landing and close; the rest of CLAUDE.md stays the operator's prose |
| `docs/README.md`'s status column, each plan's status line, the build order's and the architecture plan's status paragraphs | `plans.json` and the ledger; the Markdown keeps a one-line pointer to the Docs page and the record |
| `code-checks.md` | `checks.json`, rendered on the Checks page and by `tally checks render` for anyone who wants the Markdown |
| the build logs' sections | `buildlog.json` entries, rendered on demand |
| the decisions' status column | `decision.setStatus` at the commit that builds it; rendered |
| the evidence bundle copied into `reports/` | `reports/<date>/<name>.json` citing record ids; `evidence.bundle` copies only the logs the report cites |
| `track-rules.md` and the standing orders | the harness's rules (§9) and the config; what is the tracked repository's stays in its RULES.md and its parallel-build plan |

## 9. The harness's rules (its RULES.md, in brief)

1. `docs/records/` is written by the harness alone. A hand edit is a bug; `tally doctor` finds and reports it.
2. Progress is counted from `ledger.json` and nothing else. A commit on `main` is recorded within the landing that put it there, or by `task.other`; `ledger.check` is run at every landing and must report nothing missing.
3. A session writes only its track's tasks, evidence, review and hand-off. Decisions are the operator's; questions take the next row under the lock.
4. A run record is written once, with its log's hash. A log is never edited, moved or deleted by the harness. A report cites records by id; `bundle` copies, never moves.
5. Every generated block is marked and never edited by hand; the harness overwrites it whole.
6. Records commits are docs-only, prefixed `records:`, made by the harness with the configured identity, after each verb that changes a record and at each landing. `ledger check` and the status pass over them by their prefix, so the ledger never has to record its own commits (built in Phase 1, 2026-11-03, in place of "recorded in `other[]`", which would have needed a commit to record each commit).
7. Schemas change additively. A reader refuses a schema it does not know and names it.
8. The harness never pushes, deploys, reads a `.env`, runs `sudo`, touches an archive, removes a worktree or deletes anything under `.temp/`. The landing refuses an operator checkout off main or holding an uncommitted change in a file the landing changes (until 0.3.0: any change outside `docs/records/`; §19.1), a track not on its branch, unrelated staged files, and `main` moving inside the lock, as `land.py` does today.
9. Loopback only. The one trust is the worktree binding; the machine is the operator's.
10. Small files (under 400 lines), tests first, no comments in source: the tracked repository's rules 11, 12 and 14 apply to the harness too, since the same agents build it.

## 10. The guide (what it will cover)

1. Start: `tally init` in a repository (writes `docs/records/config.json` and an empty ledger), `tally serve`, the board in the browser.
2. Connect an agent: the MCP entry for Claude Code (`.mcp.json`, streamable HTTP) and for Kiro (`~/.kiro/settings/mcp.json`), the stdio shim when needed, and what `session.open` needs from a worktree.
3. A session's first minute: `context.pack` at its level instead of reading ten documents; what each level carries.
4. A task's life: `task.claim` → tests first, `evidence.run red` → code → `evidence.run green`, `clippy`, `fmt` → `land.run` → the landing records and commits → `handoff.write` → `task.release` is implicit.
5. Parallel tracks: one server, three worktrees; who may write what; waits and how the board shows them; the locks; what happens when `main` moves inside a landing.
6. A milestone's close: `review.submit`, fixes, `checks.set` at the fingerprint, `buildlog.append`, `evidence.bundle` for the report, `views.claude()`, `plans` moved.
7. Operator operations: decisions and answers, `tally status` from a phone, reading the board.
8. Another repository: what the config needs, what it does not assume.

## 11. Migration from today, without stopping the tracks

The tracks are mid-task. The cut-over is one quiet moment between landings, and every step before it changes nothing they call.

1. **Phase 1, parity (core + cli).** `tally` reads and writes `ledger.json` with `board.json`'s meaning; `tally status` prints `status.py`'s tables; `tally land` does what `land.py` does; `tally import board` converts `board.json`. Tests: a golden import of today's `board.json`; the old scripts' five close-last checks; `land`'s refusals one by one. Nothing in the tracks changes.
2. **Cut-over A (one minute, under the landing lock).** Import `board.json` → `docs/records/ledger.json`; make `ledger.py` and `land.py` one-line wrappers that exec `tally` with the same arguments and print the same lines, so the tracks' instructions stay true. Commit the records on `main` once (`records: import the progress ledger`).
3. **Phase 2, the server and the board.** `tally serve`, SSE, the Board, Tracks, Graph and Evidence pages. `status.py --html --watch` is retired when the board shows the same.
4. **Phase 3, MCP, scope, context.** Sessions, claims, locks, `context.pack`, `docs.*`, the stdio shim, the MCP entries for Claude Code and Kiro. The guide and the harness's rules are written here, and the tracks' next prompts point at them.
5. **Phase 4, the records.** `tally import decisions|questions|checks|buildlog` from the Markdown tables (verified by rendering back and diffing to the original); `plans.json`; the generated CLAUDE.md block; the existing run records indexed from `.temp/` (they share one shape already); the 195-file bundle re-expressed as one manifest citing records (the copied logs stay where they are, per the operator's instruction that nothing under `.temp/` or a report is deleted). RULES.md and parallel-build are amended by the operator for what §12 lists.
6. **Phases 5 to 7 (§14 to §17):** the service for many repositories, working in parallel, and context as records. They replace the earlier Phase 5 (its own repository, `tally init` for a second repository, a release), which the operator closed on 2026-11-04. The remote already exists. There is no release.

Each phase ends with its tests green and a short entry in the harness's own ledger (it tracks itself).

## 12. What only the operator can decide

These change what a record means, where it is stored for good, or a rule of the tracked repository, so they are the operator's (rule 10). The harness is built to the answers.

| # | decision | recommended |
| --- | --- | --- |
| 1 | **Where the records live.** (a) `docs/records/` on `main`, committed by the harness at each landing; (b) a separate branch or an existing records-archive repository; (c) in `.temp/` with snapshots into `docs/` at each close. | **(a)**: tracked by git in the docs folder as asked; no rebase conflict, since tracks never edit the files; the cost is one `records:` docs-only commit per landing on `main` |
| 2 | **Records commits on `main`.** Rule 16 says one commit per task; a `records:` commit is no task's. | allow them as the ledger's own, recorded in `other[]`, docs-only, the operator's identity; amend rule 16 and "The progress ledger" |
| 3 | **Which Markdown becomes records.** Decisions, questions, build logs, `code-checks.md`, status lines, report indexes: yes. Plans, references, manuals, RULES.md, CLAUDE.md, READMEs: stay prose. | as listed; build logs imported as blobs first |
| 4 | **Generated blocks in CLAUDE.md and `docs/README.md`.** | yes, between markers, written by the harness only |
| 5 | **The landing moves into the harness** (`land.run`), with `land.py` as a wrapper. | yes; one protocol, one lock, the record written in the same transaction |
| 6 | **Logs stay in `.temp/`; reports cite records and bundle only what they cite.** Today's copied bundle is kept as it is. | yes, per the operator's instruction to keep every `.temp/` record |
| 7 | **The name and the port.** `tally`, `127.0.0.1:47560`. | the operator's |
| 8 | **Decisions and answers are entered only with `--operator`** (CLI or the web), never by a session's MCP call. | yes |

## 13. Not in scope

A chat between agents (§15.6's notes are records with an owner and a state, not a chat); an order path or anything that reaches a broker, the archive or the VPS; a database; authentication beyond the worktree binding; replacing git as the history; editing the plans' prose from the web.

## 14. One service for many repositories (Phase 5, approved 2026-11-12)

**Status: approved 2026-11-12, with every recommendation of §18 as written. Nothing is built.** The first §14 was approved the same morning. The operator then asked for more, and §14 to §18 are written to that:

- Tally runs as a Docker service on the operator's machine, always on.
- Repositories are added and removed in a sidebar in the browser, with no terminal and nothing written by hand for a repository.
- The improvements the tracks asked for on 2026-11-04 are built, so that agents work in parallel from many worktrees with less friction (§15).
- A repository's context is JSON records on its main branch, served through the MCP tools. No Markdown file is context (§16).
- The user of tally is an agent, not a person. The MCP surface is designed for what a session needs, and the browser is kept to what only the operator can do.

What the morning's approval settled still stands unless §18 lists it: records and config stay in each repository, a session is found from its worktree, state is kept outside the repository, configs reload, and there is an overview with a board for each repository.

### 14.1 What changes, and what stays

**What stays:**
- Each repository's `docs/records/` on its main branch, with the schemas of §4. New fields are optional (rule 8).
- `session_open({worktree, agent})`, the worktree binding and the scope rules.
- The landing's promise: main only moves by fast-forward to commits whose checks passed, in a clean checkout, each commit checked alone with the checks its own files choose, unless the landing was asked to check its tip only, which its record says (section 25).

**What changes:**
- One container serves every repository. It is the only writer of records and state.
- Agents reach it at one MCP URL. The CLI becomes a client of the same server (§14.9).
- The container has no compiler and no test runner, so it never runs a repository's commands. The agent runs them through a script tally writes, and tally checks the result (§14.8).

**Repositories are isolated.** A session reads and writes only its own repository's records, context and logs. Nothing is shared between repositories: what agents working in parallel share, they share inside one repository. The overview and `repo_list` show every repository's name and progress, and nothing more.

### 14.2 The service

`Dockerfile` and `compose.yaml` at this repository's root build one image: Node 24, git, and the built packages. Nothing of any tracked repository's toolchain is in it.

```yaml
services:
  tally:
    build: .
    restart: unless-stopped
    user: "${TALLY_UID}:${TALLY_GID}"
    ports: ["127.0.0.1:47560:47560"]
    environment: { TALLY_HOME: /data, HOME: /data, TALLY_WORKSPACE: "${TALLY_WORKSPACE}", GIT_CONFIG_GLOBAL: /etc/tally/gitconfig }
    volumes:
      - "${TALLY_WORKSPACE}:${TALLY_WORKSPACE}"
      - "${TALLY_GITCONFIG}:/etc/tally/gitconfig:ro"
      - tally-data:/data
```

- **The workspace** is one folder of the host that holds every repository tally may track. It's mounted at the same path inside the container. The path must be the same on both sides: git stores a worktree's location as an absolute path, a run record stores its log's path, and an agent sends its worktree's path.
- **The user** is the operator's uid and gid, so every file and commit tally writes belongs to the operator.
- **The port** is published on the host's loopback only (rule 11). Inside the container the server listens on every interface, since only the published port reaches it.
- **The data volume** holds the list of repositories and all runtime state (§14.4). The image makes `/data` writable by any user, so a new volume works under the operator's uid.
- **Restarts.** Everything live is on disk, the landing queue included, so a restart loses only the calls in flight. Starting, stopping and rebuilding the container are the operator's. No agent does them.
- **Git as the operator has it.** The image carries a recent git and git-lfs. The operator's global git config and global ignore file are mounted read-only, so the container's git ignores and filters what the host's git does. When a repository is added, tally checks that the container's git can open it and that every filter its attributes name exists in the container. If one is missing, the repository isn't added, and the answer names it.
- **Tally's own commits** (records, and a landing's commit) are made inside the container with the config's identity. Tally turns hooks and signing off for each of these commits, since the hooks' tools and the operator's keys aren't in the container (§18).

### 14.3 The list, the sidebar and the operator's actions

`/data/repos.json` holds `{schema: 1, repos: [{name, root, addedAt}]}`. A `name` is the short handle in URLs, tool arguments and the state folder: lowercase letters, digits, `-` and `_`, unique. `root` is the repository's own checkout, never a linked worktree, and is inside the workspace.

The browser has a sidebar on every page that collapses to a narrow strip. It lists each repository with its progress, its open sessions and its count of problems.

- **Add.** A folder browser shows the folders of the workspace and marks the git repositories. Choosing one adds it under a name that defaults to the folder's name.
  - A repository that already has `docs/records/config.json` is added as it is.
  - Otherwise tally starts it: a default config, an empty ledger whose baseline is main's tip, and a `context/` folder, committed as `records: start tracking`.
    - The identity is the repository's own `user.name` and `user.email`, or the service's default (`TALLY_GIT_NAME`, `TALLY_GIT_EMAIL`).
    - `commands.test` is the command tally can read from the repository's files (a `package.json`, a `Cargo.toml`, a `pyproject.toml`). When it finds none, the command is one that fails and says no check is set yet.
    - There is one stage, and the fingerprint covers the whole repository.
    - The first session fills in the real checks and the context (§16.7), not the operator.
  - Tally adds `.temp/` to the repository's `.git/info/exclude` when the repository doesn't ignore it already. No tracked file changes.
- **The default repository** is the first one added, until the operator picks another in the sidebar. A call that names no repository goes to it (§14.5). `repos.json` keeps its name as `default`.
- **Remove** takes a repository off the list. It's refused while sessions are open in it, and it leaves the records, the worktrees and the state alone.
- **Questions and decisions.** An open question shows in the sidebar and on its board with a box for the answer. A decision is entered the same way. The CLI's `--operator` keeps working and makes the same call.
- **Closing a session.** A board lists its open sessions, and the operator can close one that was left behind.

These are the operator's actions. They exist as HTTP calls for the browser (`/api/repos`, `/api/fs`, `/api/r/<name>/operator/…`) and no MCP tool does them. Agents get `repo_list`, which only reads.

Every route checks the request's `Host` and `Origin`. The operator's actions also need a JSON body and a header that a web page can't send to another site. So a page open in the operator's browser can't add a repository or answer a question, though it can reach the loopback port.

### 14.4 Runtime state

Each repository's state is in `/data/state/<name>/`: `sessions.json`, `claims.json`, `locks.json`, `queue.json`, each session's inbox, and `locks/landing.lock`. `Repo` gains `name` and `stateDir`, and `statePath(repo, …)` joins under `stateDir`, so its callers don't change. Tests set `TALLY_HOME` to a temp folder.

The server is the only process that writes state. The landing lock stays as a guard against a second server on the same data folder. A build from before this phase, run on the host, takes a different lock file. That's why the cut-over stops it first (§17.2).

### 14.5 Finding the repository

- **The registration** is one URL, `http://127.0.0.1:47560/mcp`, added once to each agent tool at user scope. `tally mcp` on stdio stays as a bridge to that URL for an agent that can't speak HTTP.
- **`session_open({worktree, agent})`.** `git rev-parse --path-format=absolute --git-common-dir` in the worktree names the shared `.git`, and its parent is the repository's root. Tally looks that root up in the list, then finds the track whose worktree it is. The repository's own checkout on its main branch gives operator scope. `track` is still accepted and, when given, must agree.
- **Tools that carry a session** use that session's repository. A session id is looked up in each listed repository's sessions file.
- **Read tools with no session** take `sessionId` or `repo`. With neither, the call goes to the default repository (§14.3). So adding a second repository breaks none of the first one's callers.
- **The server's instructions** tell a new session all it needs to begin: call `session_open` with the folder it works in. No file in the repository has to point an agent at tally.

### 14.6 Reloading

One `Repos` object holds the list and an open `Repo` for each entry. Every call and every watcher tick asks it for a repository. It re-reads `repos.json` or a `config.json` when the file's time or size has changed. A config that no longer parses doesn't take effect: the last good one stays, and the error shows on that repository's board and in its tools' answers. This closes open item 5.

### 14.7 The server's paths

| path | serves |
| --- | --- |
| `/` | the overview: every repository's progress, sessions, queue and problems |
| `/r/<name>/` | that repository's board |
| `/api/r/<name>/…` | its API and its `events` |
| `/api/repos`, `/api/fs` | the sidebar: the list, and the workspace's folders |
| `/mcp` | the one MCP endpoint |
| `/api/…`, `/events` with no name | the default repository, until the release after a second repository is listed removes these paths |

There is one watcher for each listed repository, started and stopped as the list changes. The web build's fetches are relative to its board's base, so one build serves every board.

### 14.8 Commands run where the toolchain is

The agent's own shell has the compiler, the test runner and the database. The container has none of them. So tally writes scripts, and the agent runs them.

- **The runner.** At `session_open` and at `track_open`, tally writes `<worktree>/.temp/tally/run`, a POSIX `sh` script. It's generated, overwritten whole, and never in git.
  - The agent calls `.temp/tally/run <kind> [--task M:T] -- <command…>` in its own shell.
  - The script runs the command with the config's environment (`commands.env`, `unset`, `tmpdir`) and shows the output live. It keeps the output in a log under the repository's own `.temp/tally/logs/<track>/`, outside the worktree, so closing a track loses no log.
  - It takes the command's own exit status before the output is piped to the log, so the pipe can't hide a failure.
  - When the command ends, the script writes a result under `.temp/tally/results/`: the kind, the task, the commit, the times, the exit status, the log's path, and the command's arguments separated by NUL bytes. These are plain fields. The server builds the JSON record from them, so nothing depends on quoting done in `sh`. The result is written whole and then renamed, so the server never reads half of one.
  - A run that outlasts the agent tool's limit on one command is started in the background. The script writes its result whether or not anything reads its output.
- **Taking the result in.** The repository's watcher sees the new file within its 2 s tick. The server hashes the log, reads the totals and the failing tests out of it, and writes the run record. The agent made no MCP call and met no lock. The record reaches the agent's inbox (§15.6).
- **A landing's checks** run the same way, from a script written for that turn (§15.3).
- **What tally can vouch for.** Tally no longer sees the tests run. It checks that the result is for the commits being landed, that the command is the configured one, that the run began after the turn did, and that the log is there to be hashed. A session that wrote a false result by hand would not be caught. That's the trust rule 11 already gives: the worktree binding, on the operator's own machine.

### 14.9 The CLI as a client

Every `tally` verb becomes one HTTP call to the server at `TALLY_URL` (by default `http://127.0.0.1:47560`). The server does the work, so there's one writer and no lock for a script to lose.

- `--repo`, `TALLY_REPO` and the upward search still name the repository, which must be listed.
- The verbs and their output don't change. The ones the first tracked repository uses are held to today's output by tests.
- `tally land` joins the queue, waits its turn, runs the turn's script on the host and reports as today.
- A verb that takes a file (`land --message`, `checks set --file`, `buildlog append --file`, the importers) reads it on the host and sends its contents, since the container doesn't see the host's folders outside the workspace. A verb that takes a folder of logs to hash in place (`import evidence`, `report manifest --bundle`) needs that folder to be inside the workspace.
- If the server isn't reachable, the command says so and exits 1. Nothing is written.

(Built 2026-11-12 with one difference: a command is carried out by the service only when `TALLY_URL` is set. With it unset, `tally` works on the files itself, as before, so a repository that isn't served needs no service. The service runs the same command code and sends back its lines and exit status. `tally land` joins the queue, runs each turn's script on the host and waits. A file named with `--message`, `--file`, `--config` or `--narrative` from outside the repository is copied into the repository's `.temp/tally/spool/`, where the service can read it.)

## 15. Working in parallel (Phase 6)

Five tracks reviewed tally on 2026-11-04 after a day of parallel work. This section is built from what they asked for. §15.8 maps each of the 15 open items to its answer.

### 15.1 A session's first call

`session_open` answers with the session, its **brief** and its **inbox**. The brief is the context pack for the session's scope (§16.4): the project in short, the rules, the track's tasks, its hand-off, who else is working and on what, and what overlaps. One call, and the session can start.

**A session that goes quiet.** Every call marks its session as seen, and so does every run taken in from its worktree. A session not seen for four hours (the config's `sessions.idleMinutes`) is closed by the server the way `session_close` closes it: its claims and locks are released. Its next call is told to open again. Until now nothing ended a session whose agent had died.

### 15.2 Tracks that agents open

A track stops being a line an operator adds to the config. `docs/records/tracks.json` holds the tracks agents opened: `{name, branch, worktree, parent?, purpose, paths?, openedBy, openedAt, closedAt?, closedBy?, closedWhy?}`. Tracks in `config.json` are still read, so the first tracked repository's tracks work unchanged. A name is in one of the two places only.

- **`track_open({name, purpose, parent?, paths?})`** creates the branch at main's tip and the worktree at `<worktreeRoot>/<name>`, writes the runner into it, and answers its path. `worktreeRoot` is a new optional field of the config, `.temp/worktrees` by default. An operator-scope session may open any track. A track's session may open a child of its own track.
- **A child track** is how one track runs helpers in parallel. The helper gets its own worktree, branch and session, and the board shows it under its parent. The parent's session may write its children's tasks, evidence and hand-offs. Every track, child or not, lands on main through the same queue.
- **`track_close({name})`** removes a track's worktree and branch. Tally removes only worktrees it created (§18).
  - It's refused while the track has a session, a claim, uncommitted work, or commits that aren't on main.
  - It's also refused while a child of the track is open.
  - `git worktree remove` deletes ignored files without asking, and that is what is wanted of build output (`node_modules`, `dist`, caches, logs, a copied `.env`): they are deleted with the worktree and named in the answer (`cleaned`). What an agent kept under the worktree's `.temp/` (its scratch, apart from tally's runner folder and the landing checkout) is moved to `<repo>/.temp/closed/<track>/` first (`kept`); a second track of the same name gets the close time in its folder's name. A changed tracked file, a file git neither tracks nor ignores, and a commit not on main still refuse.
  - Tally removes its own landing checkout, then keeps the scratch, then removes the worktree with `git worktree remove`, then the branch with `git branch -d`. Run logs aren't in the worktree (§14.8), so none is lost.
  - **The service closes a landed track that sits idle** (`closeIdleTracks`, on its tick after the sessions expire): tally opened it, its ledger has at least one task of the track and all are landed, its branch is not ahead of main and its worktree is clean, no session, claim, queued landing or open child, and it has rested for `worktrees.idleMinutes` (60 by default) since the later of its last landing and its last session ending. `tracks.json` records `closedBy` (agent `tally`) and `closedWhy`. The parent track, or main, is told once; a landed and idle track whose worktree holds uncommitted files is reported once, naming them. `worktrees.keep: true` turns it off. A session that opens in a closed track's folder is told so.
- **One task per session** stays. A helper is a child track with a session of its own.

### 15.3 The landing queue

Each repository has one queue, first come first served, kept in `queue.json`.

1. **`land_start({sessionId, message?, files?, task?, deferred?})`** makes today's checks of the arguments and the worktree, and answers a ticket: its position and, for each ticket ahead, the track, the agent, the state and since when. It never blocks.
2. **`land_wait({ticket, seconds})`** holds the call open for up to 30 seconds and answers as soon as the ticket's state changes. An agent can't sleep, so this is how it waits.
3. **The turn.** When a ticket reaches the head, tally takes the landing lock for a moment and prepares it:
   - It checks the worktree again, since the agent may have staged or committed since `land_start`.
   - It commits the named files, and only those, on the track's branch, and remembers that tip.
   - It moves the track's landing checkout to that tip and rebases there, onto main. The agent's own working tree isn't touched, and the stash is never used.
   - It writes the turn's script, `.temp/tally/land.sh`, with the commits and the checks in it (§15.4).
4. **The checks.** The agent runs the script. It moves the landing checkout to each commit ahead of main, oldest first, runs that commit's checks, and writes one result. While it runs, the queue shows the ticket as "testing", and so does the board.
5. **The finish.** When the result shows every commit passed, tally takes the lock again. If main moved in the meantime, the turn is prepared again and its checks run again. Otherwise tally does the rest as one step:
   - It fast-forwards main.
   - It records the task as landed with the final hashes, along with any deferred parts (§15.5).
   - It commits every record waiting on disk as one `records:` commit.
   - It brings the track's branch up to main with `git reset --keep`, when the branch still ends at the tip tally remembered. Uncommitted work is kept, though a file staged since then comes back unstaged. If the agent committed more in the meantime, or main changed a file the agent has open changes in, tally leaves the worktree alone, and the answer says the landing is done and the worktree needs `git rebase`.
6. **A failure** changes nothing on main. The landing's own commit is undone as today, its files left staged. If the agent has committed on top of it, the commit stays on the branch, and the answer says so. The answer names the commit, the check, the log and the failing tests.
7. **A turn that stalls.** While it runs, the script touches a heartbeat file from a loop that ends when the script does. A turn loses its place when its script hasn't started within two minutes, when its heartbeat is a minute old with no result, or when it passes the turn's hard limit (an hour, unless the config says otherwise). Its commit is undone and the next ticket begins. A session that died never blocks the queue.

Records are written at any time and never wait on a landing. Their commit is made at the finish of each landing and when the last session closes, and never while a turn is in progress. So a records commit can't make a turn's checks stale, and main's log shows one `records:` commit for each landing at most. `tally records commit` waits for the turn to end.

Not built: letting one landing pass another when their files can't overlap. Checks chosen by path keep a small landing's own turn short, and the queue is fair.

### 15.4 Checks and evidence

- **Checks by path.** `commands.checks` is a list of `{name, command, paths[]}`. A landing runs every check whose paths match a file its commits change. The list is a new optional field. `commands.test` stays required, and with no list a landing runs it, or the track's own `test`, as today. An end-to-end check listed for the pages' paths then runs at every landing that touches them.
- **Evidence** comes from the runner (§14.8). It needs no MCP tool and no CLI. `--task` is optional: without it, the record is filed under the session's claimed task, or under the commit when the work has no task.
- **A red must fail.** A run of kind `red` whose command exited 0, or whose log shows no failed test, is kept with a `problem` and doesn't count as the task's red.
- **`evidence_run` and `land_run` go.** The server can't run commands. `evidence_record` stays, and `land_start` with `land_wait` replaces `land_run` (§17.2).

### 15.5 A ledger that shows its gaps

All of these are new optional fields.

- **A milestone's `delivers`:** `[{id, what, paths?}]`, the things it owes.
- **A task's `brief`, `paths` and `covers`:** what to do, the files it expects to touch, and the deliverables it covers.
- **A task's `waitsOn`:** `[{task?, note?, what}]`. A wait names a task or a note. The free-text `waits` is still read.
- **A landed task's `deferred`:** `[{what, to?}]`, the parts that didn't land and the task that will finish each.

`ledger_check` then reports, beside the commits no record names:
- a deliverable no task covers
- a wait on a task that doesn't exist or that nobody has planned
- a deferred part with no task to finish it

A task with deferred parts shows as "landed in part" until those tasks land. A wait clears itself when the task it names lands, and the waiting session is told. `ledger_check` takes `scope: "mine"`, so a track sees only what is its own to fix.

### 15.6 What agents see of each other

- **Overlaps.** At each tick the watcher works out, for every open track, the files it has changed: its commits ahead of main and its uncommitted work. Two tracks that changed the same file overlap. The brief shows a session's overlaps, and so do `task_claim` and `land_start`. They warn, and refuse nothing.
- **Notes.** `note_post({to, kind, text, about?})` leaves a note for one track, several, or all. The kinds are `heads-up`, `request`, `answer` and `finding`. `about` names paths or a task. `note_reply` and `note_done` follow it up. Notes are records of their own, in `context/notes.json`: `{id, from, to, kind, text, about?, at, replies[], doneAt?}`. Unlike a context entry (§16.3), a note changes: it gathers replies and is marked done.
- **The inbox.** Every tool's answer carries `inbox`: what is new for this session since its last call. Each item is delivered once, and `inbox_get` reads them again.
  - a note addressed to its track or to all
  - the operator's answer to a question it asked
  - a commit on main that changed a file it has changed
  - a wait of its own that cleared
  - its place in the queue, and its turn
  - a run taken in, or kept with a problem
  - a context entry that changed for the paths it works on
- **Leftover stashes** are listed among the board's problems, since every worktree shares one stash list.

### 15.7 Answers that say what happened

- **Outcomes.** A writing tool answers `{done: true, …, records: "waiting" | "<commit>"}`. An error means nothing was written. Writes queue inside the server, so "the lock is held" is never an answer.
- **Filters.** Every list tool takes `ids`, `group`, `track`, `state`, `since`, `limit` and `fields`. The defaults are small: `question_list` answers the open rows, and `board_get` with `scope: "mine"` answers only the session's own track.
- **`docs_list`, `docs_read` and `docs_search` go.** No track used them. `context_get` takes their place (§16.4).

### 15.8 The 15 open items

| # | open item of 2026-11-04 | answered by |
| --- | --- | --- |
| 1 | a real landing queue | §15.3 |
| 2 | sub-streams inside a track | child tracks, §15.2 |
| 3 | the ledger can't show gaps | `delivers`, `covers`, `waitsOn`, §15.5 |
| 4 | no "landed in part" | `deferred`, §15.5 |
| 5 | config is read once | §14.6 |
| 6 | evidence needs a planned task | the runner's optional `--task`, §15.4 |
| 7 | evidence has no CLI command | the runner, §14.8 |
| 8 | a session holds one task | child tracks, §15.2 |
| 9 | leftover stashes | no stash in a landing, §15.3; listed as problems, §15.6 |
| 10 | "not in the ledger" between landing and recording | one finishing step, §15.3; `scope: "mine"`, §15.5 |
| 11 | a wait note outlives the wait | waits that clear themselves, §15.5 |
| 12 | the landing checkout and rule 10 | §18 |
| 13 | `docs_read` and `docs_search` unused | removed, §15.7 |
| 14 | no end-to-end check at landings | checks by path, §15.4 |
| 15 | a track looks ahead of main while it tests | the "testing" state, §15.3 |

### 15.9 Phases, and records committed once per phase (2026-11-14)

- **A phase is a stage.** `docs/records/phases.json` holds `{id, name?, weight?, goal?, decision?, openedAt?, openedBy?, closedAt?, closedBy?, summary?, commit?}`: a phase added by `phase_add` whole (it joins `config.stages` when the repository is opened, as `tracks.json` joins `config.tracks`), and, for a stage the config lists, only its id and closing fields once it is closed. `commit` is the tip of main the phase closed at.
- **`records.commitAt: "phase"`** is one optional config key, read with `commit` and `batch` by one function, `recordsMode`: `never`, `each`, `rest` or `phase`. In `phase` mode none of the three flush points (a write, the last session closing, a landing finishing) commits; `phase_close` and `records_commit` do. A release that does not know `commitAt` reads the config as `rest`, which is safe. A new repository starts in `phase` mode.
- **`phase_close`** checks (tasks landed, nothing unrecorded on main, no landing queued), closes the tracks that are wholly the phase's with the close of §15.2, writes the closing fields, tells every session, and makes one records commit; a landing's turn makes it wait, and the flush after that landing still makes it. A closed phase takes no milestone or task. `phase_list` runs the same checks without writing.


## 16. Context as records (Phase 7)

### 16.1 The principle

**Everything a session needs to know about a repository is a JSON record on its main branch, served through the MCP tools. No Markdown file is context: tally reads none and writes none.** This replaces the second half of principle 2, and §8's generated Markdown blocks.

- A record has fields, so a session asks for what applies to its files, its task, or the time since it last looked.
- Tally is the only writer, so two tracks never conflict over a context file.
- An entry is small, so a brief is small.

A repository follows this section once its config says `context: "records"`, a new optional field. A repository added in the sidebar after Phase 7 starts that way. Until a repository's config says so, its packs carry its RULES.md and CLAUDE.md as they do today (§16.8).

### 16.2 The context folder

`docs/records/context/` on main:

| file | holds |
| --- | --- |
| `project.json` | the project in short: its purpose, its stack, its layout (a path and what is there), its glossary |
| `rule.json` | what must and must not be done, each with its reason |
| `convention.json` | how things are done here |
| `area.json` | the parts of the code: their paths, what each is for, its entry points |
| `interface.json` | what one part promises another |
| `howto.json` | how to build, run, test and debug |
| `finding.json` | what a session learned that the next one would otherwise learn again |
| `notes.json` | what agents told each other; these are notes, not entries (§15.6) |

The rest of a repository's context already has a home in `docs/records/`: the ledger, with each task's `brief` in place of a plan's prose, the decisions, the questions, the hand-offs, the checks and the build log.

### 16.3 An entry

`{id, kind, title, text, paths[], tags[], refs[], by: {track, agent}, at, replaces?, section?, source?, template?, tailor?, retiredAt?}`

- **`id`** is the kind and the next number, given by tally under the lock, the way a question takes its row.
- **`title`** is at most 120 characters and **`text`** at most 2,000. A longer subject is several entries.
- **`paths`** are globs from the repository's root. They are how an entry finds its reader.
- **`refs`** name other records: a decision, a question, a task, another entry.
- **An entry is never edited.** A change is a new entry that `replaces` the old one, so "what changed since" is always answerable.

### 16.4 Reading

- **The brief** (§15.1) is assembled when asked and never stored. It carries:
  - `project.json`
  - every rule
  - the track's tasks with their briefs, and its current hand-off
  - the titles and ids of the entries whose paths match the track's or the claimed task's
  - who is working, on what, and the overlaps
  - the count of open questions
  - the inbox
- **`context_get({ids?, kind?, paths?, tags?, query?, since?, limit?, fields?})`** answers entries. `paths` asks for what applies to these files. `since` asks only for what changed after a time, so a session that resumes reads the difference and not the whole.
- **`task_claim`** answers with the entries that match the task's paths, and its overlaps.
- **`context_pack({level})`** stays as the assembled view at each level. For a repository whose config says `context: "records"`, it's built from records alone.

### 16.5 Writing

- **`context_put({kind, title, text, paths?, tags?, refs?, replaces?})`** and **`context_retire({id, why})`**. Any session may write a convention, an area, an interface, a how-to or a finding, and its track and agent are recorded.
- **Rules and `project.json`** are written only by an operator-scope session. A track that wants a rule asks a question. A rule needs its `section` and its `source` (§16.9).
- **A landing refuses a commit that touches `docs/records/`.** Records change through the tools alone (rule 1).

### 16.6 Logs as records

- **A run** is a record: the command, the exit, the totals and up to 20 failing tests with their first lines. Its raw output stays a file where it fell, named in the record by path and hash (rule 6). It's a program's output, and a session rarely needs more than the record.
- **The build log** takes structured entries: `{group, milestone, date, commits[], built, verified[{what, check, totals}], decided[], corrected[], open[]}`. Sections imported as Markdown stay as they are.
- **The activity log** is `docs/records/log/<date>.json`: one event for each write, `{at, session, track, agent, verb, target, result}`. `activity_get({since, track?})` tells a session what happened while it was away. From 0.4.0 it also holds one `session_open` event when a session opens (no target) and one `session_expire` event when tally closes an idle session (target `idle <n> min`, written before the session ends, so it rides with the records commit that end may make). A session has at most one `session_expire` event: tally looks for it in the days since the session was last seen before writing it. A write that fails does not stop the session from ending; it is shown as the repository's problem, in the sidebar and the overview, for an hour. An ended session is read back from these events and stored nowhere else (§20.4).

### 16.7 A new repository's first session

A repository added in the sidebar has a default config and an empty context. The first operator-scope session's brief says so, and lists what is missing. That session reads the code and fills it in:
- `repo_configure({checks?, commands?, stages?, fingerprint?, locks?, worktreeRoot?})` writes `config.json`. The config is a record like the others: written through a tool, never by hand.
- `context_put` writes the project, its areas, its how-tos and its conventions.

Nothing lands unchecked in the meantime. A landing runs the default `commands.test`, and where tally could read no command from the repository's files, that default fails by design.

### 16.8 Repositories that already have Markdown

- **The importers** (`tally import decisions|questions|checks|buildlog|plans|documents`) stay as the one-time way in.
- **The Markdown verbs** (`views claude`, `buildlog render`, `checks render`, the plans and documents indexes, a report's narrative) keep working for the first tracked repository until its config says `context: "records"`. The operator sets that day. A repository added after Phase 7 never has them.
- **Moving a repository's prose into context** is a session's work in that repository: its rules become rule entries, its plans become milestones' `delivers` and tasks' `brief`s, and what its standing notes said becomes entries. Tally never deletes or rewrites a repository's Markdown. What becomes of those files is that repository's decision.

### 16.9 The rulebook template (2026-11-14)

Rules need a shape, and a repository needs somewhere to start.

- **A rule has a section and a source.** Two optional fields on an entry, required of every rule written from now on: `section` (`authority`, `safety`, `working` or `once`) and `source` (whose word it is and when, or a decision's id). A rule written before has neither, reads as it is and sorts last. Two more fields belong to the template: `template` (the key of the template rule an entry came from, which every successor keeps) and `tailor` (the question the project still has to answer, dropped when the rule is replaced).
- **The template** is 29 short rules in four sections, shipped in tally (`rulebook-template.ts`), with the specifics of any one project taken out. `rulebook_adopt` (operator session, on the operator's word) adds each rule the repository has never had, so a rule that was tailored or retired never comes back and a second call adds nothing. It is a call and not a file written when a repository is added, because a repository that already has rules would otherwise get 29 it did not ask for.
- **Tailoring** is `rule_tailor`: the successor of a rule, with what is left out kept, so a `source` alone settles a rule as written. An operator session's brief lists the rules that still carry a question (`tailoring`).
- **Reading.** `rulebook_get` answers the rules in rulebook order. The brief carries each rule slim (`id`, `section`, `title`, `text`), and the size cut spares `brief.rules` while any other part can be cut, so a large brief never loses the authority and safety rules first.

## 17. Building it, and the cut-over

### 17.1 The order

Each phase is written tests first, in temp repositories under `TALLY_HOME`, and ends with every test green.

1. **Phase 5, the service.**
   - `core/repos/`: the list, finding a repository from a worktree, reloading.
   - State under `stateDir`.
   - The runner, and taking results in.
   - The landing in turns, with its queue.
   - The server's paths, the sidebar and the operator's actions.
   - The CLI as a client.
   - The image and `compose.yaml`.
2. **Phase 6, working in parallel.** `tracks.json` with `track_open` and `track_close`, checks by path, the ledger's new fields and what `ledger_check` reports, overlaps, notes, the inbox, outcomes and filters.
3. **Phase 7, context as records.** The context folder and its tools, the brief, the structured build log, the activity log, `repo_configure` and a new repository's first session.

The landing in turns is in Phase 5, not Phase 6, because a server in a container can't run the tests itself.

### 17.2 The first tracked repository's cut-over

One quiet moment, chosen by the operator, once Phase 5 is green:

1. Stop the board. Wait until no session is open and no landing runs. Run `tally records commit` if records are waiting.
2. Start the container, and add the repository in the sidebar.
3. Change each agent tool's registration to the URL.
4. Change the tracks' standing instructions: `.temp/tally/run` in place of `evidence_run`, and `land_start` with `land_wait` in place of `land_run`. Scripts that call `tally land` or any other CLI verb don't change (§14.9).
5. `tally ledger check` must report nothing missing, and a session opened on a track's worktree must bind as before.

The repository's old state folder is no longer read. It's removed in a session of that repository, never by tally.

**Going back** from Phase 5 is clean: stop the container, restore the registration and run the previous build. No record's shape changed. From Phase 6 on, records carry new optional fields that an older build would drop when it next wrote the file, so going back past Phase 6 means giving those fields up.

### 17.3 The rules that change

RULES.md is amended as each phase is built:

| rule | change |
| --- | --- |
| 1 | the context folder is part of the records, and a landing refuses a commit that touches them |
| 5 | state is in the service's data folder, not under the repository's `.temp/` |
| 6 | a run's log is kept under the repository's `.temp/tally/logs/`, outside the worktree, and the server writes the run record from the runner's result |
| 7 | the records commit is made at the finish of each landing and when the last session closes |
| 9 | the landing refuses a result that is missing, failed, or not for the commits being landed; the agent runs the checks |
| 10 | tally creates a track's branch and worktree, and may remove a worktree it created once nothing in it can be lost; it cleans its own landing checkouts |
| 11 | the service is published on the host's loopback only |

### 17.4 As built (2026-11-12)

Phases 5, 6 and 7 are built, tests first, with 55 MCP tools, and are on `main`. The first tracked repository's cut-over (§17.2) has not been made. Where the build differs from the sections above:

**Kept until the cut-over, as §18's decision 10 says:**
- `evidence_run`, `land_run` and the three `docs_*` tools are still there. A server of one repository, started with `--repo` on the host, needs them.
- A records commit is still made at once for a repository whose config doesn't say `records.batch`. While a landing has its turn it waits, and goes in when that landing finishes (decision 9 is met for landings, not yet for every write).

**Built differently:**
- **The CLI** is a client of the service only when `TALLY_URL` is set (§14.9).
- **Overlaps** are worked out when a tool answers, not at each tick of the watcher.
- **A wait that cleared** reaches the waiting track as a note the landing leaves, so it is also a record.
- **`task_claim`** answers the entries about the task's own `paths`, and not the entries that apply everywhere.
- **The inbox** reads the last 30 seconds again on each call and skips what it has delivered, so an item written late isn't lost.
- **The activity log's events** carry no `result`: an event is written only for a write that succeeded.
- **`startRecords`** sets `context: "records"` and makes no `context/` folder. A missing file reads as empty.
- **`worktreeRoot`** must be a folder inside the repository.
- **A child track** takes its parent's `paths` when it names none, and can't go wider.
- **A landing that changes a file no check covers** is refused when the config has `commands.checks`.
- **`/api/cli`**, the endpoint the `tally` command calls, refuses a repository outside the workspace.
- **An answer** is compact JSON of at most 25,000 characters. A longer one is cut, says what was shortened, and names the arguments that narrow the tool (§15.7 asked for small defaults). `evidence_list` answers the 20 latest runs unless told.
- **Every tool** carries a title, hints (read-only, destructive, idempotent) and a description of each argument, and refuses an argument it doesn't have.
- **A commit on main the ledger doesn't record** reaches an agent's inbox, with how to record it. Before, only the board and `ledger_check` showed it, so nothing told the agent that made the commit.
- **`task_remove`** (and `tally task remove`) takes a planned task out of the ledger, with a reason. No section above asked for it: an agent that planned a task by mistake had no way to take it back, and it counted against its milestone for good. A landed task can't be removed.

**Built later (2026-11-14):**
- **The rulebook template** (§16.9): `rulebook_get`, `rulebook_adopt` and `rule_tailor`, a section and a source on every rule, and a brief that carries the rules slim. 58 MCP tools.
- **A landed worktree that sits idle is removed** (§15.2): `track_close` deletes build output and keeps notes, and the service closes a landed, idle track after `worktrees.idleMinutes`.
- **Scratch under `.temp/`**: `session_open` and `track_open` answer a `scratch` folder, `.temp/<track>/` in the worktree, and `repo_configure` refuses a `worktreeRoot` outside `.temp/`.
- **Phases and one records commit per phase** (§15.9): `phase_add`, `phase_list`, `phase_close` and `records_commit`, and `records.commitAt`. 62 MCP tools.

**Not built:**
- The board doesn't show a child track under its parent, the context or the activity log.
- Leftover stashes aren't listed among the board's problems (§15.6).
- `tally ledger check` on the command line doesn't print the gaps. `ledger_check` over MCP does.
- There are no command-line verbs for tracks, notes or context.
- A session goes quiet and is closed only where a watcher ticks: in `tally serve`, not in `tally mcp` on stdio.
- Notes and the activity log are never pruned.
- The tools declare no output schema, and their names carry no `tally_` prefix; a client tells them apart by the server's name.

## 18. What only the operator could decide (settled 2026-11-12, as recommended)

The morning's five answers stand (the first repository's cut-over at a quiet moment, the CLI's `--repo`, a repository's name, calls that name no repository, the old URLs' end), except that decision 11 changed one. The operator settled these eleven on 2026-11-12, each as recommended:

| # | decision | recommended |
| --- | --- | --- |
| 1 | **Who runs a repository's commands.** The container has no toolchain. (a) The agent runs scripts tally writes, and tally checks the results. (b) A second, small service on the host runs them for tally. (c) The container is given the host's process namespace and full privileges and runs them itself. | **(a)**: nothing more to install, the output is live in the agent's shell, and no call waits minutes. Its cost is the last paragraph of §14.8: tally trusts the result file. |
| 2 | **The CLI becomes a client of the server** (§14.9), so a script's call fails when the container is down. | yes: one writer ends the lock errors every track reported |
| 3 | **Tally's commits run no hooks and aren't signed** (§14.2). | yes; a check a hook used to make is listed in `commands.checks` |
| 4 | **What the container is given of the host:** the workspace, the one folder repositories can be added from, and the operator's global git config, read-only. | the folder the operator keeps projects in, set once in the compose `.env` |
| 5 | **The operator's actions move to the browser** (§14.3): adding and removing repositories, answers, decisions. Any process on the machine could call them; no MCP tool does. | yes, under rule 11's trust |
| 6 | **Tally creates worktrees and branches, and removes the ones it created** when `git` itself agrees nothing is lost (§15.2). This rewords rule 10, with open item 12. | yes: without it a helper's worktree needs a terminal to make and to clear |
| 7 | **Every track lands on main.** A parent track groups its children and may write their records, and nothing lands into a parent's branch. | yes: one queue and one protocol |
| 8 | **Context is JSON records only** (§16), rules are written only at operator scope, and the first tracked repository keeps its Markdown verbs until a day the operator sets. | yes |
| 9 | **The records commit rides with a landing** for every repository (§15.3), which makes `records.batch` the only behaviour. | yes |
| 10 | **`evidence_run` and `land_run` go at the cut-over** (§17.2), so the tracks' standing instructions change that day. | yes; it follows from decision 1 |
| 11 | **A call that names no repository, once a second one is listed.** The morning's answer was to refuse it. With a sidebar, adding a second repository would then break the first one's callers at that moment. | change it: such a call goes to a default repository, the first one added, until the operator picks another |

## 19. Landings refused early, commands in the agent's shell, reviews, parked parts, brief levels and question ids (0.3.0, built 2026-11-14)

Built from `docs/plans/2026-11-14-1150-landing-evidence-reviews-parked-plan.md`, which answers the review the coordinator of the second tracked repository wrote after its first phase on the upgraded tally. The operator took every recommended answer of the plan's §3, and added three points (19.8).

### 19.1 A landing and the operator checkout (decision 1)

A landing is stopped by an uncommitted file in the operator checkout only when the landing changes that file, and the refusal names the files and the folder. `operatorChanges` reads `git status -z` (a rename by both its paths, the records folder left out); `blockingChanges` is the one function that decides, so the operator can return to "any uncommitted file stops a landing" by changing it alone. The check runs at `land_start` (the named files and the track's own commits, three-dot from main: no ticket is made), at a ticket's turn after the rebase (before any script), after the checks pass (the refusal says they passed), and in `land_run`. An operator checkout off main, or in the middle of a merge, rebase, cherry-pick or revert, is refused at `land_start`. `ledger_check` and an operator's brief answer `checkout: {branch, changed, total}`. Rule 9 is reworded to match.

### 19.2 Commands run in the agent's shell (decision 2)

`TALLY_COMMANDS`, read by one function in core, is `service` (the default: the CLI, stdio and a service on the host, unchanged) or `agent`, which the image sets. With `agent`, `evidence_run` checks the task, runs nothing, records nothing and answers `ran: false` with the runner line (`cd <worktree> && sh .temp/tally/run …`, each word quoted only when it needs it); it is registered as a read. `land_run` is refused there and names `land_start`. Each has a description for each value. A run that exited 126 or 127 is never evidence by any path: one guard serves `evidence_run`, `evidence_record` and the runner's results, and the runner catches it first. A runner result the service refuses leaves a note for its track. The image gains no docker, socket or project tool.

### 19.3 A review is a record (decision 3)

`docs/records/reviews.json` keeps `{id, milestone, task, track, commit, reviewer, verdict, blocking, findings?, summary, follows?, report?, by, at}`; the verdict is `land`, `fix`, `stop` or `waived` (an operator session's). A task's state is its newest review's: none, clear or open. A task gains `landedAt`, stamped when first recorded as landed. With `config.reviews: {required, from}`, a task landed at or after `from` without a clear review is a gap in `ledger_check`, in the board's notes and in `phase_close`'s blockers. A landing is never refused for it. `review_record`, `review_list`.

### 19.4 A deferred part can be parked (decision 4)

A part is `{what, to}` or `{what, parked: {why, decision?, owner?}}`. Parking is an operator session's, or a writing session's that names a decision in the record; who may park is checked where the parts are given, not again when a queued landing is recorded. A parked part is no gap, leaves its task whole and stops no phase. Each part has a state: unplaced, waiting, done or parked. `deferred_list`, `deferred_set`; `ledger_check` answers `parked`.

### 19.5 The brief has levels (decision 5)

`session_open` takes `brief`: `full` (the default, as before), `work` (no rules' text; the project's name and purpose) or `land` (the tasks by id, who works and the rulebook; it reads nothing else). Every level answers `rulebook: {rules, changedAt}` and names its level. An operator keeps the records waiting and the checkout at every level.

### 19.6 Question ids (decision 6)

A question's id is `Q-<row>`, computed; `Q-24`, `Q-024` and `24` are read alike. An operator session may give `question_add` a `number` at or above the next (at most 999 ahead). `question_edit` keeps the old words in `edits`; it is the operator's or the asking agent's on its own track, and a question now keeps the track that asked it. Commit subjects and the inbox say `Q-24`; the CLI's `question answer <row>` and its printed lines are unchanged.

### 19.7 The smaller points (decisions 7 and 8)

Every package is at 0.3.0, and the handshake carries it. Each tool added from 0.2.0 on has `since`; `session_open` and `repo_list` answer `server: {version, tools, newest}`, so a client whose list predates an upgrade can tell. `session_close` answers `records`, a sentence for the records mode; `track_close`'s `cleaned` answers `what`. Waiting records stay in the working tree (decision 7).

### 19.8 What the operator added to the plan

1. `phase_close`'s description names all four of its refusals in `blockersOf`'s order (tasks not landed, unrecorded commits, gaps, queued landings), and a test keeps it so; `phase_list` names them too.
2. `phase_close` answers `withoutBuildLog`, not `missing`, and leaves it out when every milestone has a build-log section. It stops nothing.
3. A records commit's subject is at most 70 characters with its prefix; a longer one is cut at the last ": " or ", " within the limit (else the last space), and the whole sentence goes first in the body. Rule 7 says so.

### 19.9 Stored formats

Every change is an optional field or a new file: a task's `landedAt`, a part's `parked`, a question's `track` and `edits`, `config.reviews`, `reviews.json`. The previous release reads all of them; frozen copies of its ledger and questions schemas are test fixtures. A previous release that writes such a record drops the new fields, so the service and the CLI should run the same release.

### 19.10 The tool list

67 tools, every one with a title, four hints in `TOOL_META` and a strict input. `tools/list` is held under 77,000 characters (compact JSON) by shorter shared parameter texts, and a test guards it. From 0.7.0 one function (`mcp/src/listing.ts`) shapes each tool's entry in the list: it leaves out the input's `$schema` and the `execution` block that says only the protocol's default, and lists a hint only where it differs from the protocol's default (a read lists `readOnlyHint` and `openWorldHint: false`; a write lists `destructiveHint: false` when it destroys nothing, `idempotentHint: true` when it is safe to repeat, and `openWorldHint: false`). A client that reads the list with the protocol's defaults sees the four hints `TOOL_META` gives.

## 20. A Done view, and a board of open work (0.4.0, built 2026-11-16; 0.4.2 after two fixes)

Built from `docs/plans/2026-11-16-1239-done-view-plan.md`. The operator asked for a view of everything completed (phases, tasks, sessions) beside Board, Evidence and Docs, and for a board that shows only what is incomplete or active. The plan's §3 decisions are built as written.

### 20.1 The decisions

1. **The view is called Done**, after Board: Board, Done, Evidence, Docs on a wide screen; Board, Tracks, Graph, Done, Evidence, Docs in the phone's bottom bar.
2. **A milestone is finished** when every task of it has landed on main (or it is marked built) and `ledger_check` lists no gap for it: no deliverable without a task, no deferred part with nowhere to go, no landed task that still needs a review. A part left to a task that exists, or parked, is no gap. This is the line `phase_close` draws.
3. **A phase leaves the board when it is closed**, not when it reaches 100%. An open phase whose milestones are all finished stays, as one line that says an operator session closes it.
4. **Nothing unfinished is hidden.** A closed phase with an unfinished milestone again is back on the board, marked.
5. **A landed task of a milestone in progress** is counted on the board as before, and listed in Done under its milestone, marked as in progress.
6. **Ended sessions are computed from the activity log**, and stored nowhere (rules 3 and 5). A repository with no log lists none and says why.
7. **No MCP tool is added, and no answer loses anything.** `board_get` and `tally status` still answer every milestone; each row gains `finished`.
8. **The percentages do not change.**
9. **The version is 0.4.0.**

### 20.2 One meaning of finished

`summarize` sets `MilestoneRow.finished`: the row's share is 1 or more, and no gap names the milestone, the gaps being `findGaps` and the landed tasks `needingReview` returns. A landed commit not on main already lowers the share. `rowsOf` keeps the milestone's own `finished`, as it keeps its share.

### 20.3 The board

`web/src/open.ts` chooses, in pure functions: a phase is on the board when it is open or has an unfinished milestone, and under it only its unfinished milestones are drawn. A quiet line under a phase says how many of its milestones are finished and opens Done; another after the phases says how many closed phases are in Done; an empty state says when nothing is open. The panel's detail counts open and finished milestones, and the hero draws a line for each phase on the board and one for the closed rest.

### 20.4 Done

- **`GET /done`** answers `{counts, phases}`, built by `doneWork` (`core/src/done/`) from the status the board already shows, so the two never disagree. A milestone is listed when it is finished or has a landed task, with its landed tasks only; a phase when it is closed or has a listed milestone, the closed ones first (latest close first), then the open ones in the board's order. A task is dated by its `landedAt` ("recorded") or else by its commit's committer date ("commit"), read with one `git log` over the ledger's baseline to main; tasks are latest first, undated ones last in the ledger's order. A deferred part carries its state, and why when parked. A closed phase's `closedBy`, `summary` and `commit` (the tip of main it closed at) come from `phaseRows`, so `board_get` does not grow.
- **`GET /done/sessions?limit=<n>`** answers `{kept, sessions, total, earlier?}`, built by `endedSessions` from the activity log: a session is every event with one id, left out while it is open. It runs from its first event to its last; it opened "recorded" when the first is `session_open`, else "first write" (every session before 0.4.0); it ended "closed", "expired" or "unknown"; `writes` counts its other events, and `tasks` the distinct targets of its `task_claim`, `task_land` and `land_start`, at most 8. The newest first; `limit` is 50 unless asked, 500 at most; the newest 120 day files are read, and `earlier` counts the older ones. `kept` is false, and the list empty, where the config does not say `context: "records"` and the log folder is empty.
- **The page** reads both only while Done is shown, and again on each snapshot; loading more sessions asks for a larger limit, so a new snapshot keeps what is loaded. Phases and tasks fold, the first phase open. A failed read says so in a sentence, with the server's reason and a "Try again" button.

### 20.5 The surface

67 tools before and after. Two descriptions change: `board_get` names `finished`, and `activity_get` names the two new events. `tools/list` is 76,411 characters in the image (76,222 before). `/done/sessions` is bounded by `limit`; `/done` carries every landed task and has no bound (a bound by unfolding is left for later). No stored format changes: the activity log gains two values of `verb`, which the previous release reads as events like any other.

### 20.6 Left out

A smaller `board_get` that answers only open work (the largest saving in sight for an agent's context; a decision of its own), `tally status` printing only open work, closed tracks as a third list in Done, ended sessions for a repository with no activity log, a bound on `/done`, a smaller snapshot, one word for a phase (the page says "Stage"), and search in Done.

### 20.7 The fix round (0.4.2)

The planner's check found two flaws in the expiry of idle sessions, both fixed. A failed write of `session_expire` (or a failed read of the log before it) stopped the session from ending and, on the service, the rest of the watcher's pass; now the session is ended all the same, its claims and locks released, the pass goes on, and the failure is the repository's problem, one sentence naming the track and the agent, held for an hour. An end that failed before the session was removed wrote the event again on each pass; now tally looks for the session's event before writing, so a session has at most one. The version counts the two fixes: 0.4.2.

## 21. Commits of records only, command-line writes on record, and an open board (0.5.0, built 2026-11-16; 0.5.1 after one fix)

Built from `docs/plans/2026-11-16-1602-third-review-plan.md`, which answers the third review, written by the coordinating agent of the second tracked repository after two days of use since 0.3.0. Of its eight findings, two became fixes to how records behave (F1, F4), and two became small corrections to the Done build (F6 and F7, with a button's words beside them). Three more (F5, F2 and F3) became four optional parts, and the operator chose one: part D, the open board (F5). Parts E (commits the config tells the check to pass, F2), F (moving a milestone to another phase, F3) and G ("Phase" for "Stage" on the page, F3 too) are specified in the plan and not built, so that they can be later. The eighth finding, a tag for the release, was already done.

### 21.1 The decisions

1. **A commit that changes only files under the records folder is passed over by the check, whoever made it.** The review asked for the narrower rule, only files under the log folder. The wider one is chosen because in the `phase` mode every record waits on disk between commits, so a script that commits a dirty tree sweeps up the ledger or a decision as easily as the log. It weakens no protection: the check has only ever read a commit's subject, which anyone can write.
2. **What the check passes over, it shows.** `ledger_check` lists those commits, so a script that commits records is visible and never silent.
3. **Decisions stay on the command line, and `--operator` stays a declared flag.** No MCP tool is added for them: an operator session is declared in the same way, so a tool would add attribution and no authority, and the activity log gives the attribution without one.
4. **A write made from the command line appears in the activity log under the session `cli`.** Done's sessions leave it out, because it is not a session.
5. **The version is 0.5.0**, the operator's choice: `ledger_check` gains a field, the command line gains options and `board_get` an option.

### 21.2 A commit of records only (F1)

- **One answer for what main still owes.** `owedCommits` (`core/src/ledger/owed.ts`) answers `{ missing, passed }`. `unrecorded` stays the first step, so a commit a record names, or whose subject starts with the records prefix, is no candidate. A candidate that changes at least one file, every one of them under `records.dir`, is passed with the why `records only`. Its files are those changed against its first parent, so a merge is judged by what it brought to main. Git is asked about candidates only, so a clean ledger costs what it did.
- **Every caller uses it:** the check, the status's problems, the inbox notice, `phase_close`'s blockers and `tally ledger check`. None of them names a passed commit. A track's check judges its paths by the same first-parent files.
- **`ledger_check`** answers `passed: { total, shown }`, the newest ten with commit, subject and why. When the total is above zero its text gains one line, such as "the check passes over 3 commits on main that change only files under docs/records". `tally ledger check` prints the same line and keeps its exit code, which counts only what is missing.
- **In the `phase` mode**, a session's close event that waits on disk and is swept up by another commit, a release script's say, now leaves the check clean, and shown.

### 21.3 A decision or an answer on record (F4)

- **The state is said, not guessed.** `tally decision add`, `replace` and `setStatus` take `--state`, one of the five states a decision already keeps: in force, built, partly built, decided, not built, and other. Without it the state is read from the status as before. When that reading gives `other`, the answer says so and names `--state`. Another value is refused, with the five named, and nothing is written.
- **The write is logged.** Where the repository keeps an activity log, each write leaves one event after it succeeds: `decision_add`, `decision_replace` and `decision_status`, each aimed at `<group> / <id>: <state>`, and `question_add`, `question_answer` and `question_edit`, each aimed at the question's id. The event's session is `cli`, its track the main branch, its agent the `--by` value, or `cli`. `add` and `replace` gain `--by` for this, and the record's own `by` stays the operator's, whose decision it is.
- **In the command line's layer.** The event is written by the command, not by core, because the MCP tools for questions are already logged by their decorator. After it, the waiting records are committed when no session is open, as the decorator does. A failed write is said, on the error stream, and the command still succeeds: the decision stands.
- **On the service too.** A command carried out by the service runs the same code, so it leaves the same event.

### 21.4 Three corrections to the Done build (F6, F7)

- **A session's tasks** also come from its `review_record` and `evidence_record` events. An evidence event is aimed at `<milestone> / <task>, <kind>`: the kind that ends it is dropped, so it and `<milestone> / <task>` are one task. Every other target is taken whole (21.8). In the second tracked repository the session that ran both of its lanes, which showed no task, now shows two.
- **The closed-phase line** says how many milestones it holds: "1 closed phase, with 1 finished milestone, is in Done". The two lines under the board then add up to the finished count above it.
- **The button under the sessions** says how many it will load: "Show 7 more" when 7 remain.

### 21.5 An open board for agents (F5)

`board_get` takes `rows`: `all`, the default, as before, or `open`. With `open`, `rows` holds only the milestones that are not finished, and `finishedRows` counts the others. It works with either scope; with `fields`, `finishedRows` stays beside `rows`. Its description says that a whole board may be cut to fit and that a session wants `rows: "open"` unless it asks about finished work, and a cut board names `rows` among what narrows it. In the second tracked repository the whole board is about 55,000 characters and is cut at 25,000, losing open milestones; its open board is 7 rows in about 15,000, whole.

### 21.6 The surface

- **MCP tools:** 67 before and after.
- **Descriptions that change:** `ledger_check` (`passed`), `activity_get` (command-line writes) and `board_get` (`rows`). They were tightened so that `tools/list` stays under the 77,000 characters its test holds on a host. It is 76,589 characters in the image (76,411 before) and 76,991 on a host.
- **Stored formats:** nothing changes. A decision's `state` is a field it already has. The activity log gains six values of `verb` and the session `cli`, which the previous release reads as events like any other; its Done would list `cli` as a session.
- **The command line:** three decision verbs gain `--state`, and two gain `--by`. Nothing is removed.

### 21.7 Left out

- **Parts E, F and G**, the operator's choice, specified in the plan.
- **MCP tools for decisions**, and a history of a decision's earlier states beyond the activity log (decision 3).
- **The dashboard's operator routes** that answer a question or add a decision write no event: they are not the command line.
- **A filter in Done for sessions with tasks.**
- **Not leaving the close event uncommitted in the `phase` mode.** Every record waits in that mode, by design; part A makes the wait harmless.
- **Hiding the records from `git status`**, left out of the 0.3.0 plan for the same reason as then.
- **Removing tools.**
- **A tag as a condition** for a passed commit.

### 21.8 The fix round (0.5.1)

The planner's check found one flaw, fixed. The build cut every task's target at its first comma, as the plan said, so in Done's sessions a claimed, landed or reviewed task whose name has a comma showed cut short, and two tasks that differ only after the comma showed as one. Now only an `evidence_record` target is shortened, and only by the kind that ends it, one of the kinds an evidence record can have; a task's name keeps its commas. A target is cut at 120 characters when it is logged, so an evidence event for a task with a name that long can lose its kind, or part of it, and is then taken as it stands, unless what is left happens to end in a kind's word. The version counts the fix: 0.5.1.

## 22. A lane's tasks on the lane, refused results tried again, failed greens, stale builds, the default named, what a run ran on, limits in tally's words, and a shorter hand-off (0.6.0, built 2026-11-17; 0.6.1 after one fix)

Built from `docs/plans/2026-11-17-0919-fourth-review-plan.md`, which answers the fourth review, written by the coordinating agent of the second tracked repository after 16.5 hours of parallel work on 0.5.1. Of its twelve findings, seven became parts A to G, built here. Two are features left to the operator, parts H (a lane that starts from another lane, F4) and I (records committed by age in the `phase` mode, F8), and the planner added part J (a lighter open board), seen on the service; the three are specified in the plan and not built. F12 asks for nothing.

### 22.1 The decisions

1. **Nothing here refuses what works today.** Planning a task on main from an operator session stays allowed, and a call that names no repository still reads the default: the first tracked repository's scripts rely on both. Each gains a sentence that says what happened (`notice`, and the default's name).
2. **A refused result is tried again by tally, with no new tool,** when the ledger has changed since it was refused. A tool that requeues it would add a step nobody should have to take.
3. **A green that failed is filed as `other`,** as a red that did not fail already is. Records already written are not rewritten: a run record is written once (rule 6).
4. **A stale build warns and goes on.** A script that calls the command line must not stop working because a build is old.
5. **A run records the head it ran on and whether the tree had uncommitted changes,** not the tree's own hash: computing one writes objects into the repository for every run. Attributing a run to a later commit with the same tree is left out with it.
6. **`handoff_read` keeps its default.** The earlier notes are left out only when the caller asks, as `board_get` does with `rows`.
7. **The version is 0.6.0:** two tools gain a parameter, a run record gains two fields, and the command line gains a verb.

### 22.2 A lane's tasks reach the lane, and a refused result is not lost (F1)

- **`track_open` takes `plan: { milestone, tasks }`**, `tasks` in `task_plan`'s shape (`openTrackWithPlan`, `core/src/tracks/plan.ts`). Before anything is made, `plan` is run once against the ledger as it is, with the new track's name, and `assertMilestoneOpen` is asked: a milestone that does not exist, is built or is in a closed phase, and a task that covers what the milestone does not deliver, are refused with no branch, worktree or tracks record made. Then the track is opened as before, and the tasks are planned with the reopened repository, so `assertMayWrite` sees the new track: whoever opened it may write it, as `task_plan` would allow. The answer gains `planned`, the sentence `task_plan` answers, and its `commit` is the plan's when there is one. A plan that fails once the track is made leaves the track open, and `planProblem` says why.
- **`task_plan`** from an operator session with no `track`, while a track opened with `track_open` is open (read from `tracks.json`), answers `notice`: the tasks are on the main branch's track, which tracks are open, and that `track` plans them on one. Nothing is refused.
- **A refused result that names its task is tried again** (`takeResults`, `core/src/records/results.ts`). Each pass reads the ledger's time once, in whole milliseconds. A result under `results/refused/` whose `problem` file is older, and whose `task` field names a task, is claimed as a fresh one is, by renaming it to `<id>.taking`, and recorded by the same path. Recorded, it loses its `problem` and its `untold` mark and moves to `results/taken/`. A result that names no task is never tried again (22.11). Refused again, its `problem` is rewritten and dated with the ledger's time read at the start of that pass, so that it waits for the next change, including one made while it was being judged; the track is told only when the sentence differs from the one it replaces. At most 20 are retried in one pass of one worktree, the oldest first, the rest in the next passes. A retry does not mark the worktree's session as seen. When nothing is refused the cost is one stat of the ledger and one read of an empty or missing folder per worktree; when the ledger has not changed it is one stat per refused result.
- **The note** about a refused result says where it is kept and, for a result that names its task, that it is tried again when the ledger changes. Results refused before this build are retried on the first pass after the ledger changes, and a track is told about one again only when its reason has changed.

### 22.3 A green that failed (F2)

`judgeRed` became `judgeRun`: a `red` is judged as before, and a `green` that did not exit 0 is filed as `other` with the notice "recorded as other, not green: it exited N", kept in the record's note. It holds for `evidence_record`, the runner's results, `evidence_run` and `tally import evidence`, which all go through it. The greens that failed before this build stay as they are.

### 22.4 A build that knows when it is older than its source (F3)

- **The stamp.** `npm run build` ends with `node packages/cli/dist/stamp-build.js`, which writes `packages/cli/dist/build.json`: the version in `packages/cli/package.json` and the time. The script is compiled with the rest of the command line, so the image's build stage, which copies only the package files and `packages/`, writes one too, and the final stage copies it with `dist`.
- **The warning.** `main.js` hands the arguments to `entry`, which compares the stamp in its own `dist` with its package's version before running the command. A stamp of another version, or none, gives one line on the error stream: the version it was built at, the source's, and that `npm run build` rebuilds it. Standard output and the exit code are the command's own. Run from source (a module whose file ends in `.ts`, as vitest runs it), there is no `dist` and nothing is checked. `tally version` gives no warning, since it reports the same.
- **`tally version`** is always carried out on the host, even with `TALLY_URL` set. It prints the source's version, the build's and when it was built, and, with `TALLY_URL`, the service's, which `/api/health` now answers beside `ok`. Its last line says which differ, or that they agree; it exits 1 when the build is not the source's version or has no stamp. A service older than 0.6.0 answers its health without a version, and `tally version` says so.

### 22.5 A read of the default repository names it (F5)

`reading()` (`mcp/src/source.ts`), which every read tool goes through, adds the name when the call has neither a `sessionId` nor a `repo` and the source lists more than one repository (`RepoSource.isOneOfMany`): `repo` in the structured answer. When the answer's text is exactly the JSON of its structured answer, as `ok(value)` writes it, that text is rebuilt from the named answer, so it stays one JSON value and carries `repo` (22.11). When the tool wrote its own text, as `ledger_check` does, one more text part says "read from <name>, the default repository; repo names another (repo_list lists them)". An answer that already has a `repo` key is left as it is; no read tool's answer had one. A refusal is left as it is. With one repository, a `repo` or a session, the answer is unchanged, byte for byte. The size cut still applies to a named answer, and keeps `repo`.

### 22.6 What a run ran on, and where (F6, F7)

- **Where.** The runner records `$(pwd -P)`, the folder it was called from, as `cwd`; it never changes folder, so that is where the command ran. `evidence_run` runs in the worktree and records it, as before.
- **On what.** A run record gains `head` and `dirty`, both optional. The runner already read the head; it now also runs `git -C <worktree> --no-optional-locks status --porcelain -- . ':(exclude).temp/tally' ':(exclude).temp/<track>/tally' ':(exclude).temp/<track>/landing'` before the command, and writes both into its result. `--no-optional-locks` keeps git from refreshing the index, so nothing is written to the index or the object store. The pathspecs leave out what tally keeps in a worktree, also where `.gitignore` does not ignore `.temp/`; a note of the agent's own under `.temp/<track>/`, where `.temp/` is not ignored, counts as a change. The script stays POSIX `sh`, and is rewritten at each `session_open`, so open lanes get it without being reopened. A result from an older runner has no `dirty`, and its record then has `head` alone.
- **Both runners.** `evidence_run` reads the same two with the same arguments (`treeState`, `core/src/records/tree-state.ts`). `evidence_record` records neither.
- **Readers.** `evidence_list` answers them with the record, and `fields` keeps them. The Evidence page shows "head <7 characters>", followed by ", with uncommitted changes" when `dirty` is true; its title is the run's folder.
- **Stored format.** The schema stays 1 and the fields are optional, so a record without them reads. An older build reads a record with them, but its schema strips keys it does not know: when 0.5.1 appends a run to a milestone's evidence file, or indexes runs into it, it rewrites the file, and every record in that file loses `head` and `dirty`. The records themselves stay. Going back to an older build is therefore not free for these two fields.

### 22.7 A refusal says the limit, or the path (F10, F11)

- **Too long.** The SDK validates a call against the tool's zod input schema before tally's handler runs, and answers a failure with its own prefix ("MCP error -32602: Input validation error: Invalid arguments for tool <tool>: ") followed by each zod issue's message and " at <path>". The message comes from the schema, so that is where tally answers: every text parameter with a limit is built by `limitedText` (`mcp/src/limited.ts`), whose error says "<parameter> holds at most <limit> characters; this one has <length>", in the words core already uses for limits. That covers `question_add` and `question_edit`, `context_put.source`, `rule_tailor`'s source, title and text, `review_record`'s reviewer, summary and finding names, and a deferred part's `why` and `owner` wherever one is taken. A finding's name is a record key, which zod refuses as an invalid key; the record's own error passes on the key's message. The listed schemas are unchanged, each `maxLength` with them, and no description grew. The SDK's prefix and suffix stay: changing them would mean replacing a private method of the SDK's server. (From 0.7.0 the prefix is gone, another way: section 23.4.)
- **Not found.** `keptFile` takes the path as given; when a report or a log is not found from a relative path, the refusal adds the worktree it was read against and the absolute folder accepted from any session: the repository's `.temp/` for a review's report, and its `.temp/tally/logs/` for a log (an absolute path elsewhere under `.temp/` is not accepted for a log). An absolute path that is not found is refused as before.

### 22.8 A hand-off without its history (F9)

`handoff_read` takes `history`, a whole number of 0 or more: how many of the latest earlier notes to answer, kept oldest first. With it the answer gains `earlier`, the count left out, and `history: 0` answers the current note alone. Left out, the answer is as before. The description says that a session wants `history: 0` unless it reads how the hand-off changed.

### 22.9 The surface

- **MCP tools:** 67 before and after.
- **Parameters added:** `track_open.plan`, `handoff_read.history`.
- **Answers that gain a field:** `track_open` (`planned`, `planProblem`), `task_plan` (`notice`), a read of the default repository while several are listed (`repo`), `handoff_read` (`earlier`), `evidence_list` rows (`head`, `dirty`); `/api/health` (`version`).
- **Stored formats:** a run record gains `head` and `dirty`, both optional; a runner's result gains a `dirty` file.
- **The command line:** `tally version`, and one warning line on the error stream from a stale build. The first tracked repository's commands are unchanged.
- **`tools/list`** is held under 77,000 characters by its test. To pay for `plan` and `history`, the nested texts of a planned task (which `task_plan`'s description already explains) were dropped, and parameter texts that repeated their enum's values or their schema's own default and maximum, and a few sentences that repeated a parameter's text, were shortened. It is 76,927 characters on a host and 76,551 in the image (76,991 and 76,589 before).

### 22.10 Left out

- **Parts H, I and J**, for the operator to choose, specified in the plan.
- **A tree hash on a run record**, and attributing a run to a later commit with the same tree (decision 5).
- **Rewriting the green records that failed before this build** (decision 3).
- **An option on the runner to choose the folder:** it records the folder it was called from, which is what a replay needs.
- **Recovering the events of the decisions written by the older build.**
- **Fewer operator sessions for bookkeeping** (F12): the review asks for nothing.
- **Refusing a call that names no repository**, and guessing the repository from the caller's last session: the service keeps no caller between calls.
- **Answering an invalid argument without the SDK's prefix**, which would mean patching the SDK. (Done another way in 0.7.0: section 23.4.)

### 22.11 The fix round (0.6.1)

The planner's check found one flaw in how the build behaves and two things to correct before it reached main.

- **A refused result that names no task is not tried again.** The runner's `--task` is optional: a result without one is filed under the task the session open in its worktree holds when the result is taken. That is right within seconds of the run, and wrong for a retry days later, when the session may hold another task. A refused result is now tried again only when its `task` field names a task; one with none stays refused until it is run again with `--task`, and its note no longer promises a retry. A recorded retry also loses its `untold` mark. This was a gap in the plan's rule. The version counts the fix: 0.6.1.
- **A default read's JSON text stays one JSON value.** The build added the sentence about the default repository as a second text part to every default read. A client that joins an answer's text parts and parses them as JSON, as the first tracked repository's script does with the default repository's answers, would no longer parse it. Now an answer whose text is its JSON carries `repo` inside that JSON, and only an answer whose text the tool wrote itself gains the sentence (22.5).
- **A test fixture's two commit hashes** were replaced with invented ones before the branch reached main.

## 23. Cycles, the verbs the ledger and the tracks lacked, a service that keeps house, a list that stays small, and a count of what is called (0.7.0, built 2026-11-21)

Built from `docs/plans/2026-11-20-2112-cycles-work-orders-landing-plan.md`, as amended the same evening: the first of three releases (0.7.0, 0.8.0, 0.9.0). It answers two reviews by the coordinating agent of the second tracked repository and the operator's direction of 2026-11-20: build sessions kept as numbered records, verbs the ledger and the tracks lacked, and a service that survives what the audit found. The operator's word on the tool list was that it stays at 77,000 characters, and that tally counts what is called so tools can be removed by use at the next upgrade.

### 23.1 The decisions

1. **The word is `cycle`.** "Session" stays an agent's session.
2. **A closed cycle takes** the ledger's finished milestones, closed tracks, their evidence, reviews, hand-offs and build-log entries, the whole activity log, the phases closed before the close or by it, and the notes that are done, tally's own or addressed only to closed tracks. **It leaves** the config, the context, every decision and question, checks, plans, documents, reports, the open notes and every id counter.
3. **Tally closes no cycle by itself.** When nothing stops a close, `cycle_list`, `board_get` and an operator session's brief carry a sentence that tells the agent to ask the operator; `cycle_close` takes the operator's words in `said`.
4. **A word for a run is stored as kind `evidence` with a `label`,** so the stored kinds do not grow and an older build still reads the file.
5. **The tool list stays at most 77,000 characters,** paid for by Part T in the plan's order, and the test's number does not change.
6. **The count of calls is not a record and not in git:** it is about tally's tools, not a repository's work.
7. **The version is 0.7.0.**

### 23.2 A build keeps what it does not know (E.6)

Every record read from the records folder and written back keeps the keys its schema does not name, on the file and on each item: the ledger (with its milestones, tasks, deliverables, waits and deferred parts), tracks, phases, decisions, questions, reviews, run records, hand-offs, context entries, notes, the build log and the activity log, and from this release cycles. Their schemas are `z.looseObject`; the small nested "who" objects stay plain. The writers that rebuilt a file field by field (a hand-off, a decisions import, a build-log import) now spread what they read. The config is left as it is: `repo_configure` refuses a key its schema lacks. Rule 8 says so, and that builds before 0.7.0 still drop such keys. The record types stay exact all the same: each exported type is the one inferred from its schema with the loose schema's index signature taken off, on the record and on every nested item (`Exact`, `core/src/schema/kept.ts`), so a misspelt key does not compile; a map such as the usage file's tools keeps its own, and a guard in `core/src/schema/exact.ts` fails to compile when a record type has the signature again.

### 23.3 Paying for the list (Part T)

- **One function shapes each entry** (`mcp/src/listing.ts`), replacing the SDK's `tools/list` handler: no `$schema` in an input, no `execution` block that says only the protocol's default, and a hint only where it differs from the protocol's default (19.10). A client that fills in the defaults reads the four hints `TOOL_META` gives.
- **The shared parameter texts** are said once: `sessionId` "from session_open", `repo` "a repo_list name, else the default", `limit` "at most this many", `fields` "the keys of each item to keep", `cycle` "a closed cycle's number; left out, the current". What a limit keeps and its default are in the tool's description or schema.
- **`land_run` is not registered** where `TALLY_COMMANDS=agent`: it could only refuse there. One rule (`isListed`, `mcp/src/meta.ts`) says what a place lists, and `session_open` and `repo_list` count in `server.tools` and `server.newest` only the tools listed there.
- **The ten longest descriptions** say the same in 5,627 characters where they held 6,062; a test holds them under 5,700. New tools' descriptions hold at most 300.
- **The sizes.** 76,927 characters at 0.6.1 as the host lists it; 66,889 after Part T; 73,220 at 0.7.0 with 72 tools (71,858 and 71 tools where no command runs).

### 23.4 A count of what is called (Part U)

- **Counted** for each tool: `calls`, `refused`, `cut`, `invalid`, `first`, `last`, `days`, and the calls by scope (`operator`, `track`, `none`) and by repository. Nothing else: no argument, answer or session id.
- **Seen.** tally now parses a call's arguments with the tool's own strict schema itself (`mcp/src/decorate.ts`), giving the SDK a permissive one, so a call the schema refuses is seen and counted as `invalid`; its refusal reads "Invalid arguments for tool <tool>: …", without the SDK's prefix. A call to a tool the server does not have is still the SDK's to refuse, and is not counted.
- **Kept** in memory and written atomically at most every 30 seconds and when the server stops: the service's in `<TALLY_HOME>/usage.json`, a server of one repository's (and `tally mcp`'s) in its state folder. The service stops, and writes the count, on SIGTERM, which `docker stop` sends; `tally mcp` also stops when its input ends, which the SDK's stdio transport does not watch for. A write that fails leaves the count to the next flush. A `usage.json` that is not JSON or does not fit never stops a server: it is moved aside as `usage.json.<time>.unreadable`, the count starts empty, and one line on stderr says so. Two servers that keep one `usage.json` (a stdio server and a service on the same home) overwrite each other's counts: each writes what it holds.
- **Read** with `GET /api/usage`, `tally usage` (`--json`; with `TALLY_URL` it asks the service) and the Overview page's "Tools by use": the most called first, each with `chars`, what its entry costs in the list; `never`, the listed tools never called and what they cost together; `since` and the versions served. A tool counted and no longer listed is marked so.

### 23.5 A service that keeps house (Part E)

- **Watchers from the start (E.1).** The hub starts a watcher for every listed repository when the service starts, and looks at the list again at the watcher's interval. Until now nothing ticked until a board was opened.
- **A failed write leaves nothing (E.2).** `writeJsonAtomic` writes a uniquely named temporary file, flushes it, renames it, and removes it when the write or the rename fails. A records commit adds and commits the folder without `*.tmp`.
- **A git call has a limit (E.3):** 60 seconds, or five minutes for `worktree`, `rebase`, `checkout`, `clean`, `cherry-pick` and `reset`; the suite's 18,068 git calls took at most 145 ms. A command stopped at its limit fails with exit 124 and says so, so its operation fails and releases its lock.
- **A lost lock ends one operation (E.4).** proper-lockfile's default throws from a timer and ends the process. `withLock` now notes the loss; the operation fails with `LockLost`, naming the lock, and the next one takes it again.
- **One unreadable file (E.5).** A `tracks.json` or `phases.json` that is not JSON or does not fit schema 1 no longer stops a repository from opening: it opens with the config's own tracks and stages, the board lists the file's problem, `repo_list` and the overview name it, and a write that needs the file reads it and is refused naming it. Where the service holds a whole copy it keeps it until the file is mended. A file that declares a schema tally does not know is still refused (rule 8).
- **An address for each repository (E.7).** `/r/<name>/mcp` serves the same tools; a read naming no session and no repository reads `<name>` and is not marked as the default's; `session_open` there refuses another repository's folder and names its address; the instructions name the repository; an unlisted name is answered 404. `/mcp` is unchanged.

### 23.6 The verbs the ledger and the tracks lacked (Part B)

- **`milestone_edit`** (operator): `name`, `waits` (null clears it) and `drop`: each dropped deliverable gains `dropped: {why, decision?, by, at}` and is no gap in `ledger_check`. A deliverable a landed task covers cannot be dropped; an unknown id is refused with the milestone's ids.
- **`milestone_remove`** (operator): a milestone with no landed, claimed or queued task goes with its planned tasks; its run records stay; the tracks whose tasks waited on it are told. A decision it is removed under is named in its message and commit.
- **`track_edit`** (operator, or the parent's session) widens a track `track_open` made: added paths join its own, no wider than the parent's, the row keeps `widened: [{paths, by, at}]`, and `purpose` is replaced. A track with no paths is already unlimited, and the answer says so.
- **`declared`**: `track_open` and `track_edit` answer the open tracks whose declared paths overlap this track's, with the paths they share. Nothing is refused for it.
- **`track_close` takes `endSessions`**: it ends the track's sessions that hold no claim only when nothing else stops the close. A session that holds a claim refuses first; then a claimed task, a queued ticket, an open child, a branch not landed or uncommitted work refuses, and nothing is ended. The refusal for an open session names `endSessions`.

### 23.7 Words for a run, and a review's own text (Part C)

- `evidence_record`, `evidence_run` and the runner accept the words `check`, `test`, `lint`, `typecheck`, `build`, `integration` and `e2e`, stored as kind `evidence` with `label`; such a run is judged by nothing. Another word is refused with both lists. `evidence_list`'s `kind` matches the label. The runner accepts a digit in a word, and a worktree gets the new runner at its next `session_open`.
- A run record gains `scope` (at most 200 characters): `evidence_record` takes it, and the runner `--scope`.
- `review_record` takes `text` (at most 20,000 characters) in place of `report`: tally writes `<repository>/.temp/tally/reviews/<review id>.md` and records it as the report, with its hash. Both given is refused.

### 23.8 Refusals that say what is accepted (Part D)

An unknown argument is refused by the tool's own strict schema with the tool's parameters: "decision_list takes no 'groups'; it takes group, ids, limit, sessionId, repo"; `repo` given to a writing tool adds that its repository is its session's, and `cwd` given to `session_open` that it takes `worktree`. `limit` holds at most 200 on `evidence_list`, `note_list`, `decision_list` and `question_list`. `capabilities.tools.listChanged` is false.

### 23.9 Cycles (Part A)

- **Records.** `docs/records/cycles.json` (`{schema, current, cycles: [{n, name?, from, to, closedAt, closedBy, said, decision?, summary}]}`); a repository without it is in cycle 1. A closed cycle's folder, `docs/records/cycles/cycle-<n>/`, has the records folder's layout.
- **A view** (`cycleView`, `core/src/cycles/view.ts`) opens a closed cycle as a repository whose records folder is the cycle's, with the base config joined with that folder's tracks and phases and no live state. Every function that writes a record or commits refuses a view (`assertCurrent`).
- **What stops a close** (`cycleState`, in A.4's order): a landing queued or at its turn; a commit on main the ledger does not record; a milestone with landed work that is not finished; a track `track_open` made that is neither carried (it has tasks, all in milestones not started) nor closable now by `track_close`'s rules, checked without closing (`closeBlocker`); a milestone not started in a closed phase; no finished milestone. A track listed in the config is permanent and does not stop a close.
- **The close** (`closeCycle`, `core/src/cycles/close.ts`), an operator session's. It takes the landing lock, then the ledger's, and reads the ledger once for the blockers and the plan. Before it writes anything it takes every other lock the close needs, in one order (tracks, phases, reviews, build log, notes, cycles, then each file it moves); a lock it cannot take ends the close with nothing written, naming the lock. Before it writes anything, at its start and again under those locks, it reads every file a step will read with the schema the step uses (the ledger, tracks, phases, reviews, the build log, notes and cycles); one that cannot be read refuses the close by name, with nothing written and no track closed. Under those locks it closes the closable tracks without their own commits, writes the plan to `closing.json`, carries it out and removes it, and then makes one commit, "records: cycle <n> closed", with the summary as its body, in every records mode but `never`. Every other writer takes the same file locks, so a write made meanwhile waits and is kept.
- **The plan holds decisions, not contents** (`core/src/cycles/plan.ts`): the cycle's record, the milestone, track and note ids archived, the phases the close closes and archives, the close note's words and the moves. Each step (`core/src/cycles/carry.ts`) re-reads its file, filters it by those ids, writes the cycle's part and then the current part, and changes nothing when it finds its work done: a replay does not empty an `other` recorded after the close, and the close note, numbered when it is written, is posted once. A move whose target exists is done and is skipped, and a file made again since stays in the new cycle; a move never replaces a file.
- **A close stopped part way** is finished, never undone, by the next tool call on the repository, the next writing command or the watcher's pass, under the same locks. While it cannot be finished, a tool that writes and a writing command are refused: "a cycle close is being finished: try again in a moment; until it is, a tool that writes is refused" while its lock is busy, and "a cycle close is being finished and could not be finished now: <reason>" otherwise, the reason also on stderr. Reads go on; the watcher skips its pass while the lock is busy and names any other failure as the repository's problem. With no `closing.json`, nothing of this runs.
- **Kept across cycles:** the ledger's baseline becomes main's tip, `other` empties, the milestones not started stay with their planned tasks; review, note and entry counters stay where they were; `milestone_add` refuses an id a closed cycle's ledger holds. Phases whose milestones are all archived close "with cycle <n>"; an open phase stays and is not written to the cycle's folder, which holds the phases closed before the close or by it. A stage the config lists is permanent, as a config track is: its closed record stays in the current `phases.json` as well as going to the cycle's folder, so it reads as closed after the close (the board lists it closed, and Done shows it closed with no milestones). A phase added with `phase_add` leaves with its cycle.
- **Reading.** `cycle_list` answers the current cycle (counts, `complete`, `blockers`, and `ask` once complete) and the closed ones, newest first; with `n`, one closed cycle whole with its totals and parked parts. Nine reads take `cycle` and name it. `board_get` answers `cycle: {n, complete, ask?}`, an operator session's brief the same and a track session's brief `{n}`; `complete` is checked cheapest first.
- **A closed cycle's board** answers no live git state: its tracks are the archived ones, as closed (each with `closedAt`), `time` is the cycle's closing time, `main` its last commit, and there is no origin, no unpushed count and no commits today.
- **The page.** `GET /cycles` and `GET /cycles/<n>/done`; a cycle number of more than 15 digits is refused, quoting what was sent. Cycles sits between Done and Evidence in landscape; on a phone the bottom bar keeps six entries and Cycles is reached from a line at the top of Done. A closed cycle unfolds into its phases, milestones and tasks, read once when first opened, since a closed cycle does not change. When more cycles are closed than the list holds, a line says how many of how many are shown. Long words in a name, a summary or the operator's words break rather than widen the page.

### 23.10 The surface

- **MCP tools:** 72 (71 where the service runs no command). New: `cycle_list`, `cycle_close`, `milestone_edit`, `milestone_remove`, `track_edit`.
- **Parameters added:** `cycle` on nine reads; `track_close.endSessions`; `review_record.text`; `evidence_record.scope`; the run words on `kind`.
- **Answers that gain a field:** `track_open` (`declared`), `board_get` (`cycle`), a brief (`cycle`).
- **Stored formats:** `cycles.json` and the cycles folder; a deliverable's `dropped`; a track's `widened`; a run's `label` and `scope`; a runner's result gains a `scope` file. Outside git: `usage.json`.
- **HTTP:** `/api/usage`, `/cycles`, `/cycles/<n>/done`, `/r/<name>/mcp`.
- **The command line:** `tally usage`. The first tracked repository's commands are unchanged.
- **Going back.** An older build (0.6.1, or a host command line built before 0.7.0 that writes the files beside the service) reads everything 0.7.0 writes. On its next write of a file it drops a deliverable's `dropped`, a track's `widened`, and a run's `label` and `scope`; it does not see closed cycles, and it does not refuse a milestone id a closed cycle holds. So the host's command line is rebuilt, or pointed at the service with `TALLY_URL`, before any of these is used.

### 23.11 Left out

- Asking the operator through the client's own dialog, an Evidence page for a closed cycle, moving a milestone to another phase, and pruning notes in a repository that never closes a cycle (the plan's section 11).
- Counting a call to a tool the server does not have: the SDK refuses it before tally sees it.
- Running the evaluation with a model: it spends a model's tokens, so it is the operator's to order.
- A shorter hold on the ledger and tracks locks during a close. The close holds them across its git reads and the removal of the lanes it closes, so a write made meanwhile waits up to 30 seconds and is then refused with nothing changed, and a close with many lanes to remove can take that long. Accepted for now.

## 24. The operator's word over MCP, links from decisions and tasks, the work order, covering, and role surfaces (0.8.0, built 2026-11-21)

Built from section 5 of the same plan, the second of its three releases, with the planner's notes on it: each part that reads a file and writes it back does so under that file's lock, and its first failing tests are the interleaved and hostile ones.

### 24.1 The decisions

1. **An operator session records a decision over MCP with the operator's own words quoted** in `said`. It is unconfirmed until the operator confirms it on the board. This replaces section 12 row 8 and section 21.1 decision 3 for MCP; the command line keeps `--operator`, and what it writes needs no confirming.
2. **A replacement through `decision_record` is a new claim of the operator's words:** it is unconfirmed again, and a dispute it follows is cleared.
3. **The later of Confirm and Not mine wins** and clears the other; both are the operator's own.
4. **A cited record a cycle's close archived is answered from that closed cycle,** with `cycle`, and never makes a brief fail; one that cannot be read is named as such.
5. **`cited` is whole records, or it names what it left out.** Nothing is cut in the middle of a record.
6. **A role's set is its registration:** a tool outside it is not registered at that address, so it can be neither called nor counted there.
7. **The version is 0.8.0.**

### 24.2 A decision or an answer, recorded with the operator's words (Part F)

- **`decision_record({sessionId, group, text, said, id?, section?, status?, state?, replaces?, accept?, paths?})`**, an operator session's alone. `said` holds 1 to 2,000 characters. The next `DEC-<n>`, after the highest in the file, is taken under the decisions file's lock in the same read and write as the record, so two at once get two ids; where a group's ids are of another form, `id` is required. An existing id is refused unless `replaces: {why}` is given; the old text is then kept in `replaced`. The record gains `said` and `via: {session, track, agent}`; `by` stays `operator`; the status defaults to `in force`. It is logged as `decision_add` or `decision_replace` with the group and id, never the words or the text.
- **`decision_status({sessionId, id, group?, status, state?})`**, an operator session's: `group` only where the id is in more than one. **`question_answer({sessionId, id, decision, said?})`**, an operator session's: the decision must exist; `said` is kept on the answered row.
- **A track session is refused** by each of the three before anything is read, and a session that does not exist is refused by the session lookup.
- **Confirming** (`core/src/records/decision-record.ts`): a decision with `via` and no `confirmed` is unconfirmed. `decision_list` marks it `unconfirmed: true` and takes the filter `unconfirmed`; an operator session's brief answers `decisions: {unconfirmed, disputed}`; the board lists "Decisions to confirm" with Confirm and Not mine (`confirmed: {at}`, `disputed: {at}`), through `POST /api/r/<name>/operator/decisions/<group>/<id>/confirm` and `.../dispute`, guarded as the operator's other routes are. The group and id are matched against the file, never used as a path. The board at `/` calls the same marks at `/api/operator/decisions/<group>/<id>/<mark>` for the default repository. A disputed decision is one of the repository's problems until it is replaced or its status says withdrawn; a withdrawn one leaves the list.
- **Every writing route of a repository,** like the three tools, waits on a pending cycle close and is refused while it cannot be finished.

### 24.3 Links on a decision and on a task (Part G)

- A decision gains `accept` (at most 12 lines of 300 characters, what must be true for it to count as built) and `paths` (globs from the root). A replacement keeps them unless it gives its own.
- A task gains `cites` (the ids of decisions, context entries, questions, notes and reviews it is built to) and `accept`. `task_plan` and `track_open`'s `plan` take both, and a cited id no record has is refused by name before anything is written. A record a closed cycle archived counts.
- **`decisionsToMark`**: `ledger_check` and an operator session's brief name each decision `decided, not built` or `partly built` that a task cites and whose citing tasks, in the current ledger and the closed cycles', have all landed. Only when there is one, so their answers are otherwise as before. Tally sets no status.

### 24.4 The work order (Part H)

- `session_open` takes `brief: "order"`, a track session's (`core/src/context/order.ts`). An operator session that asks for it gets `work`, and the brief says `asked: "order"`.
- **It answers** the track's unlanded tasks with `accept` and `cites`, its hand-off, `cited` (each record once, word for word: a decision's id, group, state, text and accept; an entry's kind, title and text; a question with its meanwhile and answer; a note's text; a review's verdict and summary), the rules in force with text only for `authority` and `safety` and for a cited rule, the entries about the track's paths that are not cited, `working` (the sessions on tracks whose changed files, uncommitted or ahead of main, overlap this track's) with `others` counted, `rulebook` and `cycle: {n}`.
- **A record that changed** is answered as it now stands, with `changed` (replaced, done, retired); one a close archived carries `cycle`; one that cannot be read is `{id, missing}`.
- **The cut** spares `brief.cited` and `brief.rules`. Before the answer is cut, the order fits the rules and then `cited` within 20,000 characters by leaving out whole rules, and then whole records, from the end: `rulesLeftOut` and `citedLeftOut` name their ids and say how to read each. Neither a rule's text nor a cited record is ever sliced.
- **Two rules join the template's `authority` section**: a record wins over a brief that restates it, and the builder says so to the main track before building; a brief cites a record by its id and does not restate it. `note_post` takes `record`, kept as `about.record`, and the main track's inbox shows "request from <track> (<agent>) about <id>: …".

### 24.5 What covers these files (Part J)

`covering({paths?, range?, task?, limit?, sessionId?, repo?})`, a read (`core/src/context/covering.ts`). One of `range` (`<base>..<head>`) and `paths`; both, or neither, is refused. It answers `files` (at most 200) and `filesTotal`, the decisions whose paths match a file, the context entries in force by `context_get`'s rule (an entry with no paths applies everywhere), rules first, `cited` for `task`, and `unplaced`, the count of decisions in force with no paths. No argument reaches git as an option: each side of a range must not begin with a dash or hold a space, and is proved a commit with `rev-parse --verify --end-of-options <side>^{commit}`; git is then asked only with the two full hashes; paths are matched in the process and never passed to git.

### 24.6 A builder's and a reviewer's surface (Part I)

- `/mcp/builder` and `/mcp/reviewer`, and `/r/<name>/mcp/builder` and `/r/<name>/mcp/reviewer`, serve the sets in `mcp/src/roles.ts`: the builder's 24 tools and the reviewer's 15, as the plan lists them. The one-repository server serves the two role addresses too.
- At a role's address `session_open`'s `brief` defaults to `order`, and the instructions are the role's protocol, in order, under 1,500 characters.
- `repo_list` answers `roles`: each role's `address`, `tools` and `allowedTools`, named `mcp__tally__<tool>` as a client names them when it registers the server as `tally`. `GET /api/roles/<role>` answers the same with `protocol` and `agentFile`, a sub-agent definition as text; an unknown role is 404 naming the roles. Tally writes no file.
- A call is counted with `via`: `whole`, `builder` or `reviewer`.

### 24.7 The surface

- **MCP tools:** 76 (75 where the service runs no command). New: `decision_record`, `decision_status`, `question_answer`, `covering`.
- **Parameters added:** `brief: "order"`; `cites` and `accept` on a planned task; `accept` and `paths` on `decision_record`; `record` on `note_post`; `unconfirmed` on `decision_list`.
- **Answers that gain a field:** `repo_list` (`roles`), an operator's brief (`decisions`, `decisionsToMark`), `ledger_check` (`decisionsToMark`), the board (`toConfirm`).
- **Stored:** a decision's `said`, `via`, `confirmed`, `disputed`, `accept`, `paths`; a task's `cites` and `accept`; an answered question's `said`; a note's `about.record`; two rules in the template. Each has a loose schema for parsing and an exact exported type in the guard.
- **HTTP:** `/mcp/builder`, `/mcp/reviewer`, `/r/<name>/mcp/builder`, `/r/<name>/mcp/reviewer`, `/api/roles/<role>`, and the two marks under `/api/r/<name>/operator/decisions/` and `/api/operator/decisions/`.
- **What changes for a caller:** an unknown key inside a nested input (a planned task, a deliverable, `replaces`, a deferred part, and every other object a tool takes) is refused by name with the keys that object takes, as an unknown argument is at the top (`mcp/src/strict.ts`); before, it was dropped silently. The listed schemas are unchanged.
- **`tools/list`:** 76,249 characters (74,916 with 75 tools where no command runs); the builder's 24,450 and the reviewer's 18,438. A listed input leaves out `additionalProperties: false` (the planner's T.5); the server still refuses an argument a tool does not take, naming those it takes.

### 24.8 Left out

- Asking the operator through the client's own dialog (the plan's section 11).
- Command-line verbs for the new tools: the command line keeps what it has, and its decisions need no confirming.
- Nothing else: the strict planned tasks first left out here were built before the release (24.7, what changes for a caller).

## 25. Landing options, checks made by hand, releases, a trial tree and hints (0.9.0), with its fix round (0.9.1, built 2026-11-21)

Built from section 6 of the same plan, the last of its three releases, with the planner's notes on it, and then from the fix round that followed the review of 0.8.0. 0.9.0 was not released by itself: the parts and the fix round ship together as 0.9.1.

### 25.1 The decisions

1. **Each commit is checked alone,** with the checks its own files choose, unless a landing asks for its tip only, which its record says; a repository can refuse that. This rewords `RULES.md` rule 9 and 14.1.
2. **A cancel and the advance of main are decided under one lock,** the landing lock: a cancel either wins (main is not advanced) or is refused as landed, never both.
3. **The script signals only a process group it made for the check,** proved neither its own nor 0 or 1; where it cannot make one, it signals the check's one process and says what it could not stop.
4. **A release is marked in main's order:** one at a commit before the latest release's is refused, not reordered, since a release's tasks are counted from the one before it.
5. **Tally removes only what it made:** a trial is recorded before anything is made, and its end removes only what the record names.
6. **A hint never refuses,** and one that orders is marked `suggestion: true`.
7. **The whole tool list may hold 80,000 characters** for this release (25.9).
8. **The version is 0.9.1.**

### 25.2 Landings that cost less, and one that can be stopped (Part K)

- **Checks chosen for each commit** (`core/src/land/path-checks.ts`): with `commands.checks`, each commit runs the checks whose paths match the files it changes against its first parent (`git diff -z --name-only --no-renames <commit>^1 <commit>`), so a merge in the range is checked by the commits the rebase leaves. A commit no check covers is refused when the turn is prepared, before any check runs, naming it and its files.
- **The tip only:** `land_start` takes `check: "tip"`; the script checks the last commit with every check the landing's files choose. The ticket, the landed task (`checked: "tip"`) and Done say so, and `ledger_check` answers `tipOnly` when there is one. `commands.landing.tip: "never"` refuses it at `land_start`. With no `commands.checks`, a tip landing runs the track's test on its last commit.
- **A cancel at the turn** (`core/src/land/cancel.ts`, `land-stop.ts`): `land_cancel` takes a ticket at its turn under the landing lock, writes `cancelled` to the turn's owner file, undoes the landing's own commit as after a failure, and refuses a ticket already landed. The script learns of it at its 5-second beat: it stops the running check (TERM to the check's own process group, KILL ten seconds later), runs no further commit, exits 3, and never advances main, which only the service does when it takes the result. Each check runs under `setsid`, with `--wait` where the installed one takes it; with no `setsid` it signals the check's process alone and says so in the log. `commands.landing.stop`, run once after a cancelled or failed turn with a 60-second limit, is for what a check started elsewhere; its failure is reported and changes nothing else.

### 25.3 A check made by hand (Part M)

`evidence_manual({sessionId, milestone, task, who, result, steps, device?, build?, note?, attachments?})` records into `docs/records/manual/<milestone>.json`, a new file with its own lock, under which a check's id (`manual-<n>`, per milestone) is taken. Each attachment resolves, links followed, to a file under the repository's `.temp/`, at most 200 MB and 10 to a check; its size is read before a streamed hash, and it is never copied. `evidence_list` answers `manual`, the count for what was asked, and with `kind: "manual"` the checks. A cycle's close moves an archived milestone's file and leaves a carried one's. The builder's address lists the tool; the Evidence page lists checks under their task.

### 25.4 Releases (Part N)

- **`release_mark({sessionId, version, commit?, notes?})`**, an operator session's (`core/src/releases/`): the version matches a strict pattern (letters, digits, `.`, `_`, `+`, `-`; no `/`, no `..`, no leading `-`) before it is stored or put into a path; the commit is proved a commit as `covering` proves a side (now `core/src/git/proved.ts`, shared) and must be on main. `docs/records/releases.json` is a new file under its own lock; it stays in the current folder at a cycle's close.
- **`release_list({version?, limit?, sessionId?, repo?})`** answers the releases newest first, 10 unless `limit` says, each with its tasks computed from the current ledger and the closed cycles' (landed on main after the release before it and at or before its commit, by milestone), `whatsNew` where `releases.notes` names a path holding `{version}`, and `unreleased`.
- `/api/cycles` and the Cycles page name each cycle's releases, those whose commit lies in its range.

### 25.5 Hints (Part O)

- **`oldestQuestion: {id, days}`** on `board_get` and an operator session's brief, once an open question is older than `questions.nudgeDays` (2 unless the config says). A question with no time it was asked is passed over.
- **`under`** on a task: the open questions whose meanwhile it was built on, from `task_plan`, `land_start` (carried on the ticket to the recorded task; refused without a milestone and task) and `task_land`; an id that is not an open question is refused by name, and one given again replaces the list. `question_list` answers `provisional` beside each open question, and Done marks such tasks. Answering the question, by `question_answer`, the command line or the operator's route, posts one note from tally to the main track naming that work, inside `answerQuestion` after its commit, so the command line prints what it printed before.
- **`track_list` with `order: true`** answers `ahead` (each open track ahead of main: its commits, changed files and the tracks it overlaps), `landOrder` (what others wait on first, then a track no other overlaps, then the overlapping ones, the smallest first, each with its reason) and `suggestion: true`. Its git calls carry the limits of 23's E.3, and the answer goes through the size cut.

### 25.6 A trial tree (Part L)

- **`trial_start({sessionId, name, tracks})`**, an operator session's (`core/src/trials/`): the trial is recorded in the runtime state (`trials.json`, beside the landing queue) before anything is made, then the branch `trial/<name>` at main's tip, a checkout under `.temp/tally/trials/<name>`, and each named track's commits ahead of main (`--no-merges`) picked in the order given as tally's own commits (its identity, no hooks, git's long limit), each pick recorded. A track is matched against the open tracks and never passed to git unproved. A branch or folder of that name tally did not record is refused by name. At a conflict the picks are aborted and everything named in the record removed, and the refusal names the track, the commit and the files.
- **A stop halfway** leaves the record; the next `trial_start` of the name, or `trial_end`, removes what it names.
- **Runs** in a trial go through its own runner, which needs `--task`; each is recorded against that task with `trial: {name, head}`, by a runner session on the main track. No session opens in a trial's checkout, so a trial lands nothing. `track_list` answers the open trials, and one open for more than a day is a problem.
- **`trial_end({sessionId, name})`** follows `track_close`'s rule: uncommitted work in the checkout (outside tally's own `.temp/tally/`), or commits on the branch or in the checkout beyond the picks, are named and the end refused. Otherwise it removes the checkout and the branch; run logs stay under `.temp/tally/logs/`.

### 25.7 The surface

- **MCP tools:** 81 (80 where the service runs no command). New: `evidence_manual`, `release_mark`, `release_list`, `trial_start`, `trial_end`.
- **Parameters added:** `land_start.check`; `under` on `task_plan`'s tasks, `land_start` and `task_land`; `track_list.order`; `kind: "manual"` on `evidence_list`.
- **Stored:** a task's `checked` and `under`; a run's `trial`; `manual/`; `releases.json`; a decision's `statusVia`; an answered question's `via`; a closed track's `keptFolders`; `kept` in `closing.json`; `commands.landing.tip` and `stop`, `releases.notes` and `questions.nudgeDays` in the config. Each record has a loose schema and an exact type in the guard.
- **`tools/list`:** 79,623 characters with 81 tools (78,313 with 80 where no command runs); the builder's 25,647 (25 tools) and the reviewer's 18,094 (15). The listed inputs leave out zod's safe-integer bounds, as they leave out `additionalProperties: false`; a number past them is still refused.

### 25.8 Left out

- A release's tasks counted for a release marked out of main's order: such a release is refused instead.
- Command-line verbs for the new tools.

### 25.9 The fix round (0.9.1), and the limit of 80,000

- **A dispute cannot vanish while the decision stays in force.** Withdrawn is decided in one function from the status and the state together: a status that begins with `withdrawn`, in any case, and the state `other`. Setting such a status stores `other` and refuses another explicit state, through `decision_status` and the command line alike. On a disputed decision `decision_status` refuses any status that is not a withdrawal and names the three ways a dispute ends: a replacement through `decision_record`, the operator's Confirm, or a withdrawal.
- **A builder sees which decisions are unconfirmed or disputed:** the work order's `cited` and `covering` mark them (`unconfirmed: true`, `disputed: true`), a withdrawn one cited says so in `changed`, and both role protocols say a disputed decision is not built to.
- **A file that does not parse no longer refuses `ledger_check` or an operator's `session_open`:** both name it among their `problems`. Whatever else makes a brief fail, `session_open` answers the session it opened with `briefProblem`, and ends the session before refusing if its runner or scratch folder cannot be made.
- **A status change or an answer over MCP is traced on the record:** `statusVia: {session, track, agent, at}` on the decision, `via` on the answered question; the command line writes neither, and its status setting drops an earlier session's `statusVia`. This adds to what 24.2 guarantees: a status change made by a session is traced, and is not put to the operator for confirming as a decision's words are.
- **Small:** `decision_record` refuses an id that differs from one of its group's only by letter case; `covering`'s two guards on a range's sides each have a test that fails without it; the cited records' reads return their problems instead of pushing onto their caller's list. `decisionsToMark` already left out a withdrawn decision, whose state is `other`.
- **What closed lanes kept is grouped by cycle** (the operator's ask): a track's close stores its kept folders on its record (`keptFolders`); a cycle's close moves those of every archived track to `.temp/closed/cycle-<n>/` under their own names, one decision in `closing.json` and one step per folder, never replacing a folder there and finished after any stop; a track closed earlier is matched by its exact name and the stamp's own form. `cycle_close` answers `keptMoved`, `cycle_list` a closed cycle's `kept`, and the Cycles page shows it. Nothing of it is in git.
- **The landing script** removes a check's group and pid files as soon as the check returns, so a stop between two checks signals nothing, and uses `setsid --wait` where it can.
- **The limit.** With the five tools of 0.9.0 the whole list could not stay within 77,000 characters: after the planner's T.5 and T.6 and the bounds it held 76,292 with 77 tools, and the hints' parameters and the four tools of releases and the trial tree needed about 3,300 more. The operator raised the limit to 80,000 for this release on 2026-11-21; it is to come down again when tools are removed by their use at the next upgrade. The role lists stay within 30,000 and 22,000.

