# Tally: the tracking harness, design

**Status: proposed 2026-11-03, for the operator's approval. Nothing is built.** `tally` is a working name; change it anywhere.

Tally is one service, written in TypeScript, that holds everything `docs/` is responsible for as records agents read and write through an MCP server and a CLI, shows the whole build live in the browser, and hands each agent session exactly the context its level needs. The code lives outside the repository it tracks (`.temp/tally/` now, its own repository later); the records live inside the tracked repository, under `docs/records/`, as JSON files git keeps.

## 1. Why: what exists today, and where the copies are

Tracking today is spread over five places, each with its own format, and each fact is copied into most of them.

| Where | What | Form | Writer |
| --- | --- | --- | --- |
| `.temp/tracks/board.json` | the progress ledger: milestones, tasks, the commit that landed each, waits | JSON, one file, `flock` | `ledger.py plan/land/wait/other/check` |
| `.temp/tracks/status*.py` | the status: progress bars, tracks, commit graph, open questions | Python → terminal, markdown, or `status.html` + `status-data.js` rewritten every second | the operator, by hand |
| `.temp/stage-b-resume/land.py` | the landing: rebase, `cargo test --locked`, commit with the operator's identity, `--ff-only`, under `landing.lock` | Python | each track |
| `.temp/tracks/track-rules.md`, `.temp/stage-b-resume/*.md` | the operator's standing instructions and hand-off notes | Markdown, 17k + 15k | the operator, orchestrators |
| `.temp/worktrees/<t>/.temp/<t>/` | per-milestone task lists, verification notes, reviews, fixes, follow-ups, open items; per-task `red/green/clippy/fmt/land` run records (`*.json`: command, cwd, started, seconds, exit; `*.log`) | 4,733 files, 81 MB, three conventions | each track's steps |
| `docs/` (git) | decisions (3 files), questions (3), build logs (3), `code-checks.md`, plans with status lines, `README.md`s with status columns, `reports/<date>/` | 47 Markdown files, 5 MB, of which 3.7 MB is one evidence bundle of 195 copied logs | each track's docs commit, by §4 of parallel-build |

**The same fact has up to nine homes.** "B4 DATA is built" is written in CLAUDE.md, `docs/README.md`, `build-order.md`'s status line, `architecture.md`'s status line, the plan's own status line, the decisions file's status column, the build log, the hand-off note and the ledger. A test count appears in the run record, the verification note, the review, the fixes note, the commit body, the build log, `code-checks.md` and CLAUDE.md. Evidence is kept raw under `.temp/`, then copied whole into `docs/.../reports/` at the close. Every copy is a read for the next agent and a place to drift.

**What already works, and is kept:** the ledger's shape (milestone → task → commit, `also`, `waits`), the run record's shape (`command, cwd, started, seconds, exit`, which every track already writes), the review's shape (`verdict, findings[{severity, file, line, summary, fix}]`), the landing protocol, the locks (`landing`, `checks`, `evidence-host`, `board.json`), the status page's layout, and the rule that progress is counted from one ledger only.

## 2. Principles

1. **One home per fact.** A fact is a record, stored once, in `docs/records/`. Every other appearance is a *view*, computed when asked: the status page, CLAUDE.md's standing block, a plan's status, a build log rendered as Markdown, a report's index.
2. **Records are JSON; prose is Markdown.** Decisions, questions, the ledger, checks, build-log entries, reviews, run records, hand-offs and report manifests are records. RULES.md, CLAUDE.md, the READMEs, the plans, the references, the manuals and a report's narrative stay Markdown, served and searched by the harness, never parsed into it.
3. **Hierarchy, not copies.** project → stage → milestone → track → task → attempt. A session asks for the context of its level; the pack is assembled from the homes at that moment, never stored.
4. **Scoped by worktree.** A session binds to one worktree and one track. It writes only its track's tasks and evidence; it reads everything.
5. **Git is the history.** The server is the live view and the only writer of `docs/records/`; it commits the records it changes. No database.
6. **Logs stay where they fall; records point at them.** A run's log is kept in the track's `.temp/` with its SHA-256 in the record. A close bundles the logs a report cites, once, by record id, into `docs/<group>/reports/<date>/`.
7. **The harness is repository-agnostic.** Everything about Example (tracks, worktree root, groups, the test command, the fingerprint paths, the lock names) is in `docs/records/config.json`. A second repository gets its own.
8. **Never:** push, deploy, read a `.env`, touch an archive, delete a `.temp/` folder, rewrite `main`. The harness inherits the tracked repository's rules 1 to 4 and 8 and adds none of its own powers.

## 3. The shape

```
                 browser (live board, docs, evidence)          agent sessions (Claude Code, Kiro)
                            │  HTTP + SSE                              │  MCP (streamable HTTP; stdio shim)
                            └──────────────────┬───────────────────────┘
                                               │
                                     tally serve  (one process per tracked repository, loopback)
                                     ┌─────────┴──────────┐
                                     │ store   records     │  reads/writes docs/records/*.json, atomic, one writer
                                     │ git     watcher     │  refs, worktrees, dirty files, graph; polled every 2 s
                                     │ scope   sessions    │  worktree ⇄ track binding, claims, live state (.temp)
                                     │ land    protocol    │  rebase → test → commit → ff → record → records commit
                                     │ locks   named       │  landing, checks, evidence-host, …; held by a session
                                     │ views   renderers   │  status, CLAUDE block, build log md, report index
                                     └────────────────────┘
                                               │
                        <repo>/docs/records/*.json (git)      <repo>/.temp/tally/state/  (runtime, not git)
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
| `handoffs/<track>.json` | `{current: {task, from, at, lines[]}, history[]}`, at most about 60 lines each | `stage-b-resume/*.md`, `checkpoint.md`, `proof.md` |
| `plans.json` | `[{path, group, milestones[], status: next|completed, movedAt?}]` | every plan's status line and `docs/README.md`'s status column |
| `reports/<date>/<name>.json` | a report's manifest: the records it cites by id, the logs it bundled with their hashes, the narrative's path | `reports/<date>/<name>/README.md` indexes and the copied logs |

Runtime state that is not history lives outside git in `.temp/tally/state/`: open sessions, who holds which lock, the last git snapshot, the SSE replay buffer.

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
  - **L1 track:** its worktree and branch, its tasks (planned, claimed, waiting), the shared files it may edit and when (parallel-build §4, as records), its current hand-off.
  - **L2 milestone:** the plan paths and §s the milestone names, its task list, the review checklist (Delivers, Tests, Evidence mapped to tasks), its evidence so far.
  - **L3 task:** the task, the files it touches, the tests written first, its attempts, what it waits on.
  Each pack is a view: assembled on request, never saved, so there is nothing to drift.

## 6. The tools (MCP and CLI, one surface)

Every verb exists twice with the same name and arguments: an MCP tool for agents, a `tally <verb>` command for scripts and humans. Inputs are the Zod schemas of `core`; errors name the record and the rule.

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
| locks | `lock.acquire(name, note)`, `lock.release(name)`, `lock.list` | `landing`, `checks`, `evidence-host`, …; a lock dies with its session |
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
| `docs/README.md`'s status column, each plan's status line, `build-order.md`'s and `architecture.md`'s status paragraphs | `plans.json` and the ledger; the Markdown keeps a one-line pointer to the Docs page and the record |
| `code-checks.md` | `checks.json`, rendered on the Checks page and by `tally checks render` for anyone who wants the Markdown |
| the build logs' sections | `buildlog.json` entries, rendered on demand |
| the decisions' status column | `decision.setStatus` at the commit that builds it; rendered |
| the evidence bundle copied into `reports/` | `reports/<date>/<name>.json` citing record ids; `evidence.bundle` copies only the logs the report cites |
| `track-rules.md` and the standing orders | the harness's rules (§9) and the config; what is Example's stays in RULES.md and parallel-build |

## 9. The harness's rules (its RULES.md, in brief)

1. `docs/records/` is written by the harness alone. A hand edit is a bug; `tally doctor` finds and reports it.
2. Progress is counted from `ledger.json` and nothing else. A commit on `main` is recorded within the landing that put it there, or by `task.other`; `ledger.check` is run at every landing and must report nothing missing.
3. A session writes only its track's tasks, evidence, review and hand-off. Decisions are the operator's; questions take the next row under the lock.
4. A run record is written once, with its log's hash. A log is never edited, moved or deleted by the harness. A report cites records by id; `bundle` copies, never moves.
5. Every generated block is marked and never edited by hand; the harness overwrites it whole.
6. Records commits are docs-only, prefixed `records:`, made by the harness with the configured identity, after each verb that changes a record and at each landing. `ledger check` and the status pass over them by their prefix, so the ledger never has to record its own commits (built in Phase 1, 2026-11-03, in place of "recorded in `other[]`", which would have needed a commit to record each commit).
7. Schemas change additively. A reader refuses a schema it does not know and names it.
8. The harness never pushes, deploys, reads a `.env`, runs `sudo`, touches an archive, removes a worktree or deletes anything under `.temp/`. The landing refuses a dirty operator checkout outside `docs/records/`, a track not on its branch, unrelated staged files, and `main` moving inside the lock, as `land.py` does today.
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

1. **Phase 1, parity (core + cli).** `tally` reads and writes `ledger.json` with `board.json`'s meaning; `tally status` prints `status.py`'s tables; `tally land` does what `land.py` does; `tally import board` converts `board.json`. Tests: a golden import of today's `board.json`; the five `close-last` checks of `ledger-preservation/`; `land`'s refusals one by one. Nothing in the tracks changes.
2. **Cut-over A (one minute, under the landing lock).** Import `board.json` → `docs/records/ledger.json`; make `ledger.py` and `land.py` one-line wrappers that exec `tally` with the same arguments and print the same lines, so the tracks' instructions stay true. Commit the records on `main` once (`records: import the progress ledger`).
3. **Phase 2, the server and the board.** `tally serve`, SSE, the Board, Tracks, Graph and Evidence pages. `status.py --html --watch` is retired when the board shows the same.
4. **Phase 3, MCP, scope, context.** Sessions, claims, locks, `context.pack`, `docs.*`, the stdio shim, the MCP entries for Claude Code and Kiro. The guide and the harness's rules are written here, and the tracks' next prompts point at them.
5. **Phase 4, the records.** `tally import decisions|questions|checks|buildlog` from the Markdown tables (verified by rendering back and diffing to the original); `plans.json`; the generated CLAUDE.md block; the existing run records indexed from `.temp/` (they share one shape already); the 195-file bundle re-expressed as one manifest citing records (the copied logs stay where they are, per the operator's instruction that nothing under `.temp/` or a report is deleted). RULES.md and parallel-build are amended by the operator for what §12 lists.
6. **Phase 5, its own repository.** `git init` is done on day one in `.temp/tally/`; this phase adds the remote, `tally init` for a second repository, and a release.

Each phase ends with its tests green and a short entry in the harness's own ledger (it tracks itself).

## 12. What only the operator can decide

These change what a record means, where it is stored for good, or a rule of the tracked repository, so they are the operator's (rule 10). The harness is built to the answers.

| # | decision | recommended |
| --- | --- | --- |
| 1 | **Where the records live.** (a) `docs/records/` on `main`, committed by the harness at each landing; (b) a separate branch or the existing `first-repository-records/` repository; (c) in `.temp/` with snapshots into `docs/` at each close. | **(a)**: tracked by git in the docs folder as asked; no rebase conflict, since tracks never edit the files; the cost is one `records:` docs-only commit per landing on `main` |
| 2 | **Records commits on `main`.** Rule 16 says one commit per task; a `records:` commit is no task's. | allow them as the ledger's own, recorded in `other[]`, docs-only, the operator's identity; amend rule 16 and "The progress ledger" |
| 3 | **Which Markdown becomes records.** Decisions, questions, build logs, `code-checks.md`, status lines, report indexes: yes. Plans, references, manuals, RULES.md, CLAUDE.md, READMEs: stay prose. | as listed; build logs imported as blobs first |
| 4 | **Generated blocks in CLAUDE.md and `docs/README.md`.** | yes, between markers, written by the harness only |
| 5 | **The landing moves into the harness** (`land.run`), with `land.py` as a wrapper. | yes; one protocol, one lock, the record written in the same transaction |
| 6 | **Logs stay in `.temp/`; reports cite records and bundle only what they cite.** Today's copied bundle is kept as it is. | yes, per the operator's instruction to keep every `.temp/` record |
| 7 | **The name and the port.** `tally`, `127.0.0.1:47560`. | the operator's |
| 8 | **Decisions and answers are entered only with `--operator`** (CLI or the web), never by a session's MCP call. | yes |

## 13. Not in scope

A chat between agents; an order path or anything that reaches a broker, the archive or the VPS; a database; authentication beyond the worktree binding; replacing git as the history; editing the plans' prose from the web.
