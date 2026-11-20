# Tally: the guide

How to track a build with tally: one repository, one or more agent sessions in parallel worktrees, one ledger counted from git, a live board, and an MCP server that hands each session exactly the context its level needs. Section 10 covers the service that does this for many repositories at once. [RULES.md](RULES.md) is what the harness enforces; [DESIGN.md](DESIGN.md) is why.

## 1. Start

```bash
npm install && npm run build                      # in the tally checkout
node packages/cli/dist/main.js --help             # or put packages/cli/dist/main.js on PATH as `tally`
```

`tally <command> --help` and `tally <command> <verb> --help` print that command's usage lines, with no repository needed.

In the repository to track, once:

```bash
tally init --config <a config like examples/three-tracks.config.json> --baseline <first commit>
git add docs/records && git commit -m "records: init"
```

`docs/records/config.json` names the project, its main branch, its tracks (each a worktree and a branch), its stages and their weights, the test command and environment of a landing, the paths that make the code fingerprint, the identity records commits carry, and the named locks. `docs/records/ledger.json` starts empty. From here every command finds the repository above the current folder or takes `--repo`.

If the repository already kept a `board.json` with scripts, `scripts/cutover_from_board.py` moves it over in one locked step (see its docstring).

## 2. See the build

```bash
tally status                 # terminal tables; --markdown for a chat, --json for a script
tally serve                  # the live board at http://127.0.0.1:47560/
```

Four cards along the top give the head of main, the unpushed commits, today's commits and the open questions. Below them the board shows the open work: each phase that is open, or closed with a milestone unfinished again, and under it only the milestones not yet finished, with their tasks' progress, each naming its configured track and the tracks of its tasks. A milestone is finished when every task of it is on main (or it is marked built) and `ledger_check` lists no gap for it; a line under its phase says how many finished milestones are in Done, a line after the phases how many closed phases are, with the milestones they hold, and an open phase whose milestones are all finished says that an operator session closes it with `phase_close`. The panel counts the open and the finished milestones, and the hero draws a line for each phase on the board and one for the closed rest; the percentages still count everything. Beside the board are every live worktree with its branch and uncommitted work (each branch in a colour of its own, `main` first in the one accent, the rest ordered by activity: a live session or claim above an idle branch, then the newest commit or tally event, ties by name), the commit graph (`main` on its heavy lane, a branch ahead of `main` forking off it on a lane in the branch's colour, unpushed commits hollow; it opens at the newest 60 and loads the rest as you scroll, a new commit keeping what is loaded and where you are), the ledger's problems, and who is working: each session on its track, each claimed task, each held lock. It updates over server-sent events whenever a ref, a working tree, the ledger or the live state changes. On a 16:9 screen it is three columns; on a 9:16 phone it is one page at a time behind a bottom tab bar. The Done page lists what is finished, in two parts. Phases and tasks: the closed phases first (each with its summary, who closed it and where main stood), then the open phases with something done, each folding out to its finished milestones and to the landed tasks of each milestone, finished or not, with the task's commit, its date (recorded at the landing, or else its commit's) and its deferred parts. Sessions: the ended sessions, read back from the activity log (§16.6 of the design): who, on which track, from when to when, how it ended (closed, expired, or no close recorded), how many writes and which tasks (those it claimed, landed, reviewed or recorded evidence for); the `tally` command's writes are no session and are left out; a repository whose config does not say `context: "records"` keeps no log and lists none. The Evidence page lists each milestone's run records by task, each log opened in place from where it fell. The Docs page, beside Board, Done and Evidence, lists every document by group with its purpose, then the records: a document opens rendered, links between documents stay in the page, and a JSON record opens as a tree. The same process serves the API (`/api/snapshot`, `/api/status`, `/api/graph?limit=<n>` (`{ commits, total }`, laid out from the top; the snapshot carries the first 60 and `graphTotal`), `/api/ledger`, `/api/config`, `/api/done` (`{ counts, phases }`), `/api/done/sessions?limit=<n>` (`{ kept, sessions, total, earlier? }`, the newest 50 unless asked, 500 at most), `/api/evidence`, `/api/evidence/<milestone>`, `/api/evidence/log/<id>`, `/api/docs`, `/api/docs/read?path=<path>`) and the MCP endpoint (`/mcp`).

## 3. Connect an agent

Two transports, one tool set:

- **stdio:** `tally mcp --repo <repository>` runs the MCP server on stdin and stdout; nothing else is written to stdout.
- **HTTP:** `tally serve` exposes the same tools at `http://127.0.0.1:47560/mcp` (streamable HTTP, stateless).

Claude Code, for one repository, from your shell (adds to your user configuration, not to the repository):

```bash
claude mcp add --scope user tally -- node /path/to/tally/packages/cli/dist/main.js --repo /path/to/repository mcp
```

Kiro, in `~/.kiro/settings/mcp.json`:

```json
{ "mcpServers": { "tally": { "command": "node", "args": ["/path/to/tally/packages/cli/dist/main.js", "--repo", "/path/to/repository", "mcp"] } } }
```

Any client that speaks streamable HTTP can use the `/mcp` URL instead. The service also serves each listed repository at `/r/<name>/mcp`: there a read that names no session and no repository reads that repository, and `session_open` refuses a folder of another repository and names that one's address. One server per tracked repository; the live state is shared through files, so a stdio session and the board agree.

## 4. A session's first minute

1. `session_open` with the absolute path of your worktree, your track's name (from `config.json`) and who you are. The path must be that track's worktree and on its branch, or the harness refuses and says which. The repository's own checkout on its main branch opens an operator session, which may write any track.
2. `context_pack` at your level: `project` (the rules, the milestones, who is working), `track` (your tasks, your current hand-off), `milestone`, or `task` (the task, its evidence so far, the hand-off). Read that instead of ten documents; it is assembled from the records at that moment.
3. `docs_read` for a plan section the pack points at; `docs_search` to find one.

## 5. A task's life

| step | tool |
| --- | --- |
| take the task, so the board shows it | `task_claim` |
| write the failing test, run it | `evidence_run` with kind `red` (the command runs in your worktree with the landing environment; the log is kept under `.temp/<track>/tally/`, its hash in the record). A red must show a failed test: one that exits 0, or exits non-zero with no failed test, such as a compile or usage error, is recorded as `other` with a note saying why, and the result's `notice` says so. The failed count is read from cargo's, vitest's and pytest's output; for another runner, use `evidence_record` with `summary.failed` |
| make it pass, lint, format | `evidence_run` with `green`, `clippy`, `fmt` (or `evidence_record` for a run you made yourself); a command that ran always answers with what ran, and `recorded: false` with `problem` says the record could not be written, the log being kept all the same. A green must have exited 0: one that did not is recorded as `other`, with the notice "recorded as other, not green: it exited 1", by every path a run is recorded by (`evidence_run`, `evidence_record`, the runner and `tally import evidence`). A run already recorded is not rewritten |
| land it on main | `land_run` with the explicit files and the commit message file: rebase, the configured tests, a commit as the operator, a fast-forward; refused when the checkout is dirty, the branch is wrong, files are staged that you did not name, or main moved under you. With `commands.landing` in the config the commit comes first and every commit ahead of main is tested in a clean checkout (section 7); the result's `log` holds their output, and a failure names the commit and that log. With `milestone` and `task` it records that task at the hash it made, the landing's earlier commits in `also`, and releases the claim, an unplanned task being added as `task_land` adds it (from the shell, `tally land <track> --message F --milestone M --task T <paths...>`). A landing that succeeds but cannot record says so with the commit, and is still a landing |
| record a landing made without them | `task_land` or `tally task land` with the commit (and `also` for follow-ups); the claim is released, whoever holds it, since a landed task cannot be worked |
| leave what the next session cannot find in the commits | `handoff_write` (at most 60 lines); `handoff_read` with `history: 0` reads the current note alone, and `earlier` counts the notes it left out (10.4) |
| wait on something | `task_wait`, cleared by `task_unwait` (`tally task unwait <milestone> <task>`); a commit that is no task's: `task_other` |
| drop a task that will not be done | `task_remove` with `why` (`tally task remove <milestone> <task> --why REASON`): for a task planned by mistake, split into others, or dropped. A landed task stays, since it is the record of its commit. It is refused while another session holds the task or a landing in the queue is to record it. The task's run records stay in the milestone's evidence, the tracks whose tasks wait on it are told, and the message says what the removal leaves behind |
| check | `ledger_check` must say the ledger covers every commit on main |

Every change to a record is written to `docs/records/` at once, so the board and every session see it. By default it also becomes a docs-only `records:` commit on main, made by the harness with the configured identity under the landing lock. With `records.batch: true` in the config, the changes wait on disk and go in as one commit: when the last open session closes, or on `tally records commit`, which must run before a push if a session is still open.

A records commit that cannot take the landing lock fails nothing: the change is on disk, the result shows `commit: null`, and the next records commit carries it. `tally records commit` is the exception, since committing is all it was asked to do: it fails and says so. Any other lock that stays held fails with its name and how long it waited, and says nothing was changed.

## 6. A milestone's close

| step | tool |
| --- | --- |
| index the run records a track kept on its own | `tally import evidence <dir> --milestone M --task T [--kind K] [--flat]`: each `*.json` of the shape `{command, cwd, started, seconds, exit}` becomes a record of that task, its kind read from the file name (red, green, clippy, fmt, land, coverage, sweep) unless `--kind` says, its sibling `.log` hashed and left in place, a `red` with no failed test, or a `green` that did not exit 0, indexed as `other`; a second run indexes nothing twice |
| the code as last verified | `tally checks set --file <record.json>` (the MCP tool `checks_set`), refused unless the record's fingerprint is what `tally checks fingerprint` prints for main (`git log -1 --format=%h <main> -- <the config's code paths>`); `checks get` is the record and `checks render` the Markdown a reader expects |
| the build log's dated section | `tally buildlog append --group G --milestone M --title "T" --date YYYY-MM-DD --file body.md [--commit C]...` (`buildlog_append`), one section per milestone and group; `tally buildlog render --group G` (`buildlog_render`) is the group's log as Markdown |
| a decision built | `tally decision setStatus <id> --group G --status "built in M (<commit>)" [--state built] [--by WHO]`; adding or replacing a decision is the operator's alone: `tally decision add\|replace <id> --group G --text "..." --since "..." --status "..." [--why "..."] --operator` |
| the report's manifest | `tally report manifest <date> <name> --group G --narrative <path> [--bundle <dir>] [--fingerprint F] [--evidence M[:T]]... [--decision ID]... [--question N]...`: `docs/records/reports/<date>/<name>.json` cites the records by id and hashes every file of the bundle; the copied logs stay where they are |
| the plans | `tally import plans` rescans `docs/<group>/next` and `docs/<group>/completed` into `plans.json` with each plan's title and status line; `tally plans list` |
| the document map | `tally import documents` rescans every Markdown document (the config's `extraDocs` too) into `documents.json`: its kind, group and title, its purpose from the first README table that links it, and the prose above a decisions or questions file's own rows |
| CLAUDE.md | `tally views claude` writes the standing block between `<!-- tally:standing -->` and `<!-- /tally:standing -->` from the ledger, the tracks and the open questions, and touches nothing else; `--check` exits 1 when the block is stale (`views_claude` shows it to any session and writes it for an operator session) |

Bringing an existing repository's Markdown over: `tally import decisions PATH --group G`, `tally import questions PATH --group G`, `tally import checks PATH` and `tally import buildlog PATH --group G`. Each import refuses a file that does not render back byte for byte from its record, so the Markdown can be frozen the day it is imported. Rows answered before the record existed come in with `tally import answered FILE`, a JSON array of `{row, group, question, meanwhile, answeredAt, decision}`; a row the record already holds is refused.

## 7. Parallel tracks

Each track has its worktree and its branch; each session binds to one. A track that only touches part of the repository can name its own `test` command and its `paths` in the config: its landings run that command in place of the repository's, and refuse any file outside those paths. A track session writes only its track's tasks, evidence and hand-off; it reads everything. A task is held by one session at a time, and a session holds one task at a time. The named locks (`lock_acquire`, `lock_release`, `lock_list`) coordinate what the config says needs one, such as an evidence host; a lock dies with its session. `board_get` with `scope: "mine"` is your slice of the board: your track's rows, holding only your tasks and notes, with each milestone's whole progress.

When a task of yours waits on another track, `task_wait` names what it waits for and the board draws it; move to a task that does not wait.

**A landing in a clean checkout.** By default a landing runs its tests in the live worktree before it commits, so they see every draft there, and several commits ahead of main are tested only at the tip. With `commands.landing` in the config, a landing tests exactly what lands:

1. Under the landing lock it makes the usual checks, rebases, and commits the named files on the track's branch.
2. It checks out each commit in `main..<branch>`, oldest first, in the track's landing checkout, and runs the track's test command there. It stops at the first failure and names that commit.
3. On success main fast-forwards to the commit it tested. On any failure main stays, and a commit this landing made is undone with `git reset --soft`: its files stay staged, nothing else in the worktree is touched, and the error gives the log's path.

The worktree is free while the tests run, so the track can keep working. What it commits meanwhile is not on main until its next landing. If it commits during a landing that then fails, the landing's commit stays under the new one and the error says so, since undoing it would take the new commit too. A `--verified-code` landing tests nothing, as without this. The tests hold the landing lock, so a landing of three commits holds it for three runs, and other landings wait for it.

```json
"commands": {
  "test": ["cargo", "test", "--locked"],
  "unset": ["CARGO_TARGET_DIR"],
  "landing": { "link": ["ui/node_modules"], "env": { "CARGO_TARGET_DIR": "{worktree}/target" } }
}
```

`link` lists paths symlinked from the worktree into the checkout after each clean, for instance a dependency folder. A path the commit carries is refused, since the link would hide what lands, and so is one the worktree does not have. `env` values are added to the test environment after `unset`, with `{worktree}` and `{track}` replaced, so a build cache can be shared. Both are optional: `"landing": {}` turns the checkout on with neither. A track's own `test` and `paths` work as before.

The landing checkout is a detached worktree at `<worktree>/.temp/<track>/landing`, made on first use and kept. Each commit is moved in with `git checkout --detach --force` and `git clean -fd`, so ignored files such as build output stay and everything else a run left goes. A folder there that is not that checkout fails the landing rather than being replaced. It has no branch, so the board, the graph and the watcher pass over it. `tally land` and `land_run` both keep the tests' output in `.temp/<track>/tally/landings/`, one log per landing, each commit's run under its hash and subject; `tally land` prints it as well.

## 8. Operating

- Decisions are the operator's: `tally decision add` and `replace` take `--operator`, and no MCP call enters one; `tally question answer <row> <decision>` answers a question row.
- A decision's state is said with `--state`: `in force`, `built`, `partly built`, `decided, not built` or `other`, on `add`, `replace` and `setStatus`. Without it the state is read from the status's first words, and when that gives `other` the answer says so. `--by` names who wrote it, for the activity log; the record's `by` stays the operator's.
- Reading them is cheap: `question_list` returns the open rows and how many were answered, and `answered: true` adds the answered rows; `decision_list` takes a `group` and a list of `ids`.
- Milestones are the operator's: `milestone_add` needs an operator session; `tally milestone add` from the shell is the same.
- `tally status` from a phone over SSH is the terminal view; the board is the same picture live.
- A records commit on main is normal; the check and the status pass over them by prefix, and over any commit that changes only files under the records folder, which `ledger_check` lists in `passed`.
- The old scripts of a repository that was cut over keep working: they hand their command lines to tally.

## 9. Another repository

Copy `examples/three-tracks.config.json`, set the tracks, stages, test command, fingerprint paths and identity, run `tally init --config`, commit `docs/records/`, serve. Nothing in tally knows the first repository's names; everything repository-specific is in that one config.

## 10. One service for many repositories

Sections 1 to 9 describe one server for one repository, started with `--repo`. The service is the same harness for every repository at once: one board, one MCP URL, and nothing to start per repository. It runs in Docker ([README.md](README.md), "Run as a service") or, without Docker, as `tally serve` with no `--repo`. This section is written for the agent that works through it.

**Each repository is separate.** A session belongs to the repository its worktree is in. It reads and writes that repository's records, state and logs, and no tool reaches another's.

### 10.1 Open a session

`session_open({ worktree, agent })`. The folder you work in is enough: tally finds the repository from it and the track from the folder. The answer carries:

- `id`: the session id every writing tool takes.
- `repo` and `track`: where the session is bound.
- `runner`: the path of a script in your worktree (10.2).
- `scratch`: your own folder, `.temp/<track>/` in your worktree, made for you. Plans, notes, logs and throwaway scripts go there, never in `/tmp` and never in another hidden folder (10.10).
- `brief`, in a repository that keeps its context as records (10.8): the project, every rule, your track's unlanded tasks and its hand-off, the context entries that apply to your track's paths, who else is working, how many questions are open, and what the repository's context still lacks. Ask for less with `brief: "work"` or `brief: "land"` (10.14).
- `server`: the service's `version`, how many `tools` it has, and `newest`, the tools of its two latest versions. A client reads the tool list once, when it connects. If a tool named in `newest` is not in your list, your client connected before the service was upgraded: reconnect it. `repo_list` answers the same.

`repo_list` lists the repositories the service tracks. A reading tool called with neither a `sessionId` nor a `repo` goes to the default repository: the first one added, unless the operator picked another. While more than one repository is listed, such an answer names the one it read: `repo` in the structured answer. An answer whose text is its JSON stays one JSON value, which now carries `repo` too; an answer whose text the tool wrote itself, such as `ledger_check`'s, gains a last line saying it read the default and that `repo` names another. With one repository listed, or with a session or a `repo`, the answer is as before.

### 10.2 Run a check

The service has git and no toolchain, so you run every command yourself, in your own shell, through the runner:

```bash
.temp/tally/run green --task "B2:4 manifest" -- cargo test --locked
```

- The first word is the kind of run: `red`, `green`, `clippy`, `fmt`, `sweep`, `coverage`, `land`, `evidence` or `other`, or one of the words `check`, `test`, `lint`, `typecheck`, `build`, `integration` and `e2e`, which are kept as kind `evidence` with the word as their `label` and judged by nothing: the exit is the result. `evidence_list`'s `kind` finds them by the word. Any other word is refused, and the refusal lists both.
- `--task MILESTONE:TASK` ties the run to a task, `--note TEXT` adds a note, and `--scope TEXT` (at most 200 characters) says what ran when it was not the whole, such as "the 31 tests of one module, coverage off". `evidence_record` takes `scope` too.
- The command runs with the repository's configured environment, in the folder you called the script from. Its output is shown live and kept in a log under the repository's `.temp/tally/logs/<track>/`.
- The script exits with the command's exit code.

Within two seconds the service takes the result in as a run record with the log's hash, and your next tool answer says so under `inbox`.

**What a run record says it ran on.** A run made through the runner, or by `evidence_run` on the host, records:
- `cwd`: the folder the command ran in. From the runner that is the folder you called it from, which may be below the worktree's root, so a record can be replayed as it was run.
- `head`: the commit the worktree was at when the run began.
- `dirty`: whether the worktree held uncommitted changes then (a changed tracked file, or a file git neither tracks nor ignores). What tally keeps in the worktree (`.temp/tally/`, and `.temp/<track>/tally/` and `.temp/<track>/landing/`) does not count. It is read with `git status --no-optional-locks`, which writes nothing into the repository.

A run recorded with `evidence_record` has neither `head` nor `dirty`, and a record made before 0.6.0 has neither. `evidence_list` answers them with the record, and the Evidence page shows the head, shortened, and "with uncommitted changes" when there were. Commit first and run after, and a reader can tell what was tested.

**A result it can't accept** is set aside under `results/refused/`, and tally leaves your track a note saying which run, why, and where the result is kept. A result that names its task (`--task`) is not lost: the note says it is tried again when the ledger changes, and each time the ledger changes (a task planned, moved or removed), the service records it again by the same path as a fresh one, at most 20 to a worktree in one pass. A result that names no task is never tried again, since it would be filed under whatever task your worktree's session holds by then: run it again with `--task`. A result refused because its task was on another track is recorded once the task is planned on yours, with nothing to move by hand. Recorded, it moves to `results/taken/` without its `problem`; refused again, it waits for the next change, and your track is told again only when the reason is a new one. `evidence_list` reads the records as before.

**The service runs no project command.** Its image has node, git and a shell, and sets `TALLY_COMMANDS=agent`. There, `evidence_run` checks that you may record for the task, runs nothing, records nothing, and answers `ran: false` with `run`, the exact line to run instead:

```bash
cd /path/to/your/worktree && sh .temp/tally/run sweep --task 'B2:4 manifest' -- tools/run.sh 'npm test'
```

Run that line in your own shell; the runner records it. `land_run` is not listed there, since it could only refuse: land with `land_start` (10.3). A server started on the host (the CLI, `tally mcp`, a service run outside Docker) has `TALLY_COMMANDS` unset, which means `service`: `evidence_run` and `land_run` run the command as before.

**A run that could not start is never evidence.** An exit of 127 means the shell did not find a program, and 126 that it could not run it. The runner leaves no result for either, prints why and exits with that code; `evidence_record` refuses them; and `evidence_run` on the host answers `recorded: false` with the log's last line and the runner line.

### 10.3 Land

Landings take turns in one queue per repository, first come, first served.

1. `land_start({ sessionId, files, message, milestone?, task? })` answers a ticket at once: its `state`, its `position` and who is `ahead`. Leave out `files` and `message` to land the commits the track already has.
2. `land_wait({ sessionId, ticket, after })` waits up to 30 seconds for the ticket to leave the state named in `after`. Call it again while the state is `queued`.
3. When the state is `turn`, tally has committed the named files, rebased the track onto `main` in a clean checkout, and written a script. Run the ticket's `run` command in your shell, in the background if it's long. It tests every commit ahead of `main`, oldest first.
4. Call `land_wait` again.
   - `landed`: `main` was fast-forwarded, the task is recorded, and your worktree is brought up to `main` with its other work kept.
   - `failed`: `problem` names the commit, the exit code and the log. Nothing on `main` changed, the landing's own commit is undone, and its files stay staged.

`land_cancel` takes a ticket out before its turn.

A turn is lost when its script isn't started within 2 minutes, stops for 1 minute without a result, or runs past 1 hour. The next ticket then gets its turn. If `main` moved while the checks ran, the turn is prepared again and the ticket's `note` says to run the new script.

A landing refuses a commit that changes `docs/records/`: records change only through the tools.

**The operator checkout and a landing.** A landing is stopped by an uncommitted file in the operator checkout (the repository's own folder, on `main`) only when the landing changes that file. Any other uncommitted file, a plan the coordinator is editing for example, is left as it is and stops nothing. The check is made three times, and each refusal names the files and the folder:

- at `land_start`, against the files you name and the commits your track already has, so no ticket is made;
- when the ticket gets its turn, after the rebase, before any script is written;
- after the checks pass, right before the fast-forward: the refusal says the checks passed, so land again once those files are committed or stashed.

`land_start` is also refused at once while the operator checkout is off `main`, naming the branch it is on, or in the middle of a merge or a rebase. `ledger_check` and an operator's brief answer `checkout: { branch, changed, total }`: what is uncommitted there, the records left out, twenty names at most. In a terminal the same is:

```bash
git status -- . ':(exclude)docs/records'
```

### 10.4 What the other tracks are doing

- **Overlaps.** The answers of `session_open`, `task_claim` and `land_start` carry `overlaps` when another track has changed a file yours also changes: the file, the track and who is on it.
- **Hand-offs.** `handoff_read({ track, history? })` answers the track's current note and its earlier ones, oldest first. They can be long: with `history: 0` it answers the current note alone, and `earlier` counts the notes left out; `history: 2` adds the two latest earlier ones. Ask for `history: 0` unless you need to see how the hand-off changed. Left out, the answer is as before.
- **Notes.** `note_post({ sessionId, to, kind, text, paths?, task? })` leaves a note of at most 600 characters for `"all"` or for the tracks named. The kinds are `heads-up`, `request`, `answer` and `finding`. `note_reply` answers one, `note_done` closes it, and `note_list` lists them.
- **The inbox.** Every tool answer carries, under `inbox`, what is new for your session since its last call:
  - notes and replies, among them the note a landing leaves when it clears a wait of yours
  - the operator's answers
  - commits on `main` that changed a file your track changed
  - your landing ticket's changes
  - runs taken in or set aside
  - a context entry another track added or retired for the files you work on
  - a commit on `main` that no record names, with how to record it (`task_land` for a task's commit, `task_other` for any other). The session on `main` is told about a commit made there by hand; a track is told about its own landing that named no task. With no session on `main`, every session is told

  Each item is delivered once. `inbox_get({ sessionId, since })` reads the inbox again from a time.

### 10.5 Open a track for a helper

A track is a branch and a worktree. The config names the standing ones, and an agent opens the rest.

- **`track_open({ sessionId, name, purpose, parent?, paths?, plan? })`** makes the branch `track/<name>` at `main`'s tip and a worktree for it under the repository's `.temp/worktrees/` (or the config's `worktreeRoot`), and writes the runner there. The answer carries the absolute `worktree`: start the helper in that folder and have it call `session_open` with it.
  - **A lane's tasks** are planned in the same call with `plan: { milestone, tasks }`, `tasks` as `task_plan` takes them. They go on the new track, so the lane's session can claim them and its runner's results are recorded; the answer's `planned` is the sentence `task_plan` would answer. What can be refused (a milestone that does not exist, is built or is in a closed phase, a task covering what the milestone does not deliver) is checked before the branch is made, and then nothing is made. If the plan fails once the track is made, the track stays open and `planProblem` says why; plan the tasks with `task_plan` and `track`. Who may pass `plan` is who may call `task_plan` for that track.
  - **`task_plan` from an operator session with no `track`** plans the tasks on the main branch's track, as before. While a track opened with `track_open` is open, its answer carries `notice`: the tasks are on main's track, which tracks are open, and that `track` plans them on a lane.
  - An operator session opens any track. A track's session opens only a child of its own track, and may then write that child's tasks, evidence and hand-offs.
  - `paths` limits what the track may land. A child takes its parent's `paths` when it names none, and can't go wider.
- **Every track lands on `main`** through `land_start`, child or not. Nothing lands into a parent's branch.
- **`track_close({ sessionId, name })`** removes the track's landing checkout, worktree and branch, and marks its record closed. Build output in the worktree (`node_modules`, `dist`, caches, logs) is deleted with it, and the answer names it in `cleaned` (at most twenty names, and `total`). What the agent kept under the worktree's `.temp/` is moved to `<repo>/.temp/closed/<track>/` and the answer says where in `kept`; `cleaned.what` says in a sentence what was deleted and what was kept; a second track of the same name gets the close time in its folder's name. It is refused, with nothing removed, while the track has an open session, an open child, a claimed task, a landing in the queue, uncommitted work (a changed tracked file, or a file git neither tracks nor ignores), or commits not on `main`. The refusal names them.
- **A landed track that sits idle is closed by the service.** When tally opened the track, its ledger has at least one task of it and every one is landed, its branch is not ahead of `main`, its worktree is clean, and it has no session, claim, queued landing or open child, then once it has rested for `worktrees.idleMinutes` (60 unless the config says) it is closed the way `track_close` closes it. The rest is counted from the later of its last landing and its last session ending. The parent track, or `main`, gets one note saying where the notes went. If uncommitted files block it, the same reader is told once, naming them. `worktrees: { keep: true }` in the config turns this off. A track listed in `config.json` is never closed this way. A session that opens in the folder of a closed track is told the track was closed, when, and that new work needs a new track.
- **`track_list`** lists every track: its branch, worktree, parent and purpose, where it comes from, and whether a session is open on it.

A session that makes no call and records no run for four hours is closed, and its claims and locks are released. `sessions.idleMinutes` in the config changes the time.

### 10.6 Checks chosen by path

With `commands.checks` in the config, a landing runs only the checks its changed files call for:

```json
"commands": {
  "checks": [
    { "name": "core", "command": ["cargo", "test", "-p", "core"], "paths": ["crates/core"] },
    { "name": "web", "command": ["npm", "test"], "paths": ["ui/**"] }
  ]
}
```

- A path with no `*` is a folder or a file: `crates/core` matches everything under it.
- A path with `*` is matched against the whole file path. `ui/*` matches `ui/a.ts` and not `ui/src/a.ts`; `ui/**` matches both.
- The turn's script runs each chosen check for each commit, in the list's order, and stops at the first failure. The log marks where each check starts.
- A landing that changes a file no check covers is refused, so nothing lands unchecked.
- With a `checks` list, the queue runs neither `commands.test` nor a track's own `test`. Without one, it runs those as before.

### 10.7 A ledger that shows its gaps

- **What a milestone owes.** `milestone_add` takes `delivers: [{ id, what, paths? }]`, and `milestone_deliver` adds to a milestone that exists. Both are the operator's.
- **What a task covers.** In `task_plan`, a task is its name or `{ id, brief?, paths?, covers? }`: what to do, the files it expects to touch, and the deliverables it covers.
- **A wait on a task.** `task_wait` with `on: "MILESTONE:TASK"` waits on that task. The wait clears itself when the task lands, and the track that waited is told in its inbox.
- **Landed in part.** `land_start` and `task_land` take `deferred: [{ what, to? }]`: the parts that didn't land, and the task that will finish each. The board shows the task as landed in part until those tasks land. A part can be parked instead (10.13).
- **The check.** `ledger_check` answers two lists. `scope: "mine"` keeps only your track's.
  - `missing`: the commits on `main` no record names.
  - `passed`: the commits it passes over, `{ total, shown }` with the newest ten. A commit no record names that changes only files under the records folder, such as a release script's commit of a waiting log file, is not missing, whatever its subject; the answer's text says how many were passed over. `tally ledger check` prints the same line.
  - `gaps`, each a sentence: a deliverable no task covers, a wait on a task that isn't in the ledger, a deferred part neither left to a task nor parked, and, where reviews are required, a landed task without a clear review (10.12).
  - `parked`: how many parts are parked, so the number shows without being a gap.

A writing tool's answer carries `done: true` and `records`: the records commit, or `"waiting"` when the change is on disk and goes in with the next records commit.

The list tools take filters, so an answer stays small:

| tool | filters |
| --- | --- |
| `question_list` | `ids` (`Q-24`, `Q-024` or `24`), `group`, `limit`, `history` |
| `decision_list` | `ids`, `group`, `limit` |
| `review_list` | `milestone`, `task`, `track`, `state`, `limit`, `fields` |
| `deferred_list` | `state`, `milestone`, `track`, `decision`, `owner`, `limit`, `fields` |
| `evidence_list` | `kind`, `since`, `limit`, `fields` |
| `board_get` | `scope`, `rows`, `fields` |
| `note_list` | `state`, `since`, `limit`, `everyTrack` |

**An answer is never larger than 25,000 characters.**
- `evidence_list` answers the 20 runs started last unless `limit` says otherwise, and `matched` says how many there are.
- `board_get` answers every milestone, and a large build's whole board is cut. With `rows: "open"` it answers only the milestones not finished, and `finishedRows` counts the rest: ask for that unless the question is about finished work.
- A longer answer from any tool is cut: its longest list keeps its latest items, `truncated` says which part was shortened and from how many, and a last line names the arguments that narrow that tool.
- Answers are compact JSON.

**A tool refuses an argument it doesn't have**, by name, so a mistyped argument is never silently ignored. A text longer than its parameter's limit is refused naming the parameter, its limit and the length given (`summary holds at most 1000 characters; this one has 1001`), inside the MCP library's own words for an invalid argument (`MCP error -32602: Input validation error: …`). A `report` or a `logPath` that does not exist is refused with the path it was read against: a relative path is read against your worktree, and the refusal names the absolute folder accepted from any session (the repository's `.temp/` for a review's report, its `.temp/tally/logs/` for a log). Every tool also carries a title and hints for the client: whether it only reads, whether it removes or overwrites, and whether calling it twice changes anything.

### 10.8 Context as records

A repository whose config says `context: "records"` keeps everything a session needs to know as JSON records under `docs/records/context/`, served through the tools. No Markdown file is context there. A repository added in the sidebar starts that way.

- **Reading.**
  - `context_get({ ids?, kind?, paths?, tags?, query?, since?, limit?, fields? })` answers entries. `paths` asks for what applies to those files; a folder ending in `/` or a glob asks for everything under it. `since` asks only for what was added or retired after a time, so a session that resumes reads the difference.
  - `task_claim` answers the entries about the task's own `paths`.
  - `context_pack` is built from records alone.
- **Writing.**
  - `context_put({ sessionId, kind, title, text, paths?, tags?, refs?, replaces? })` adds an entry. The kinds are `rule`, `convention`, `area`, `interface`, `howto` and `finding`. A title is at most 120 characters and a text at most 2,000; a longer subject is several entries.
  - An entry is never edited. To change one, add its successor with `replaces`, or end it with `context_retire({ sessionId, id, why })`.
  - Any session writes a convention, an area, an interface, a how-to or a finding. Rules, `project_set` (the project's purpose, stack, layout and glossary) and `repo_configure` (the config) are for an operator session. A track that wants a rule asks with `question_add`.
- **Rules.** A rule has a `section` (`authority`, `safety`, `working` or `once`) and a `source` (whose word it is and when, such as `the operator, 2026-11-14`, or a decision's id): `context_put` with `kind: "rule"` needs both, and refuses them on any other kind. Breaking a `safety` rule fails the work, whatever the tests say.
  - **`rulebook_get({ section?, waiting?, fields? })`** answers the rules in force in rulebook order (authority, safety, working, then doing each thing once), how many still wait, and which rules of tally's template this repository has never had. Call it again after a compaction.
  - **`rulebook_adopt({ sessionId })`** (operator session, on the operator's word) brings tally's template: 29 short rules. It adds each rule the repository has never had, so a rule that was tailored or retired never comes back and a second call adds nothing. It is refused where the rules are a Markdown file.
  - **`rule_tailor({ sessionId, id, source, title?, text?, section?, paths?, tags?, refs? })`** (operator session) writes a rule's successor and retires the old one. What is left out stays as it was, so `source` alone keeps the rule as written. Nine template rules carry a question (`tailor`) only the project can answer: an operator session's brief lists them under `tailoring` until each is settled with `rule_tailor` or ended with `context_retire`.
  - The brief carries each rule as `{ id, section, title, text }`, in rulebook order, and the size cut spares `brief.rules`.
- **The activity log.** Each write a tool makes is one event under `docs/records/log/`: when, the session, its track and agent, the tool and its target. A decision or a question written with the `tally` command is one event too, under the session `cli` on the main branch, its agent the command's `--by` or `cli`. `activity_get({ since?, track?, limit? })` tells a session what happened while it was away.
- **The build log** takes fields: `buildlog_append` with `built`, `verified`, `decided`, `corrected` and `open`, with or without Markdown.

**A new repository's first session.** A repository added in the sidebar has a default config and an empty context. The first operator session's brief lists what is `missing`. That session reads the code, sets the checks with `repo_configure`, and writes the project, its areas, its how-tos and its conventions. Until a check is set, the default one fails by design, so nothing lands unchecked.

### 10.9 The `tally` command

With `TALLY_URL` set (`export TALLY_URL=http://127.0.0.1:47560`), every `tally` command is carried out by the service, so there is one writer. `tally land` joins the same queue as the agents' landings, runs the turn's script in your shell, and waits for the result. Without `TALLY_URL` the command works on the files itself, which is right only for a repository the service doesn't serve.

`tally repo add PATH [--name NAME]`, `remove NAME`, `default NAME` and `list` manage the list of repositories from a shell. The board's sidebar does the same.

**A build that is older than its source says so.** `npm run build` ends by writing `packages/cli/dist/build.json`, the version it was built at and when. A `tally` command run from a `dist` whose stamp names another version than its `package.json`, or that has no stamp, prints one line on the error stream (the version it was built at, the source's, and that `npm run build` rebuilds it) and then does what it would have done, with the same output and exit code. `tally version` prints the source's version, the build's and when it was built, and, with `TALLY_URL` set, the service's (its `/api/health` answers it); its last line says which differ, and it exits 1 when the build is not the source's version.

### 10.10 What a build leaves on disk

Everything a build makes stays inside the repository's own `.temp/`, which git ignores (`startRecords` adds it to `.git/info/exclude`, and every worktree shares that file):

| path | what | written by |
| --- | --- | --- |
| `<repo>/.temp/worktrees/<track>/` | a track's worktree, on branch `track/<track>` | `track_open` |
| `<worktree>/.temp/<track>/` | the session's scratch: plans, notes, logs and throwaway scripts (`session_open` and `track_open` answer it as `scratch` and make it) | the agent |
| `<worktree>/.temp/tally/run` | the runner script | `track_open`, `session_open` |
| `<repo>/.temp/tally/logs/<track>/` | the log of each run made through the runner; it is in the repository's own folder, so it outlives the worktree | the runner |
| `<worktree>/.temp/tally/results/` | a run's result, until the service takes it in | the runner |
| `<worktree>/.temp/<track>/landing/` | the landing's clean checkout | the landing |
| `<worktree>/.temp/<track>/tally/landings/*.log` | a landing's test log, when tally runs the tests | `land_run` |
| `<repo>/.temp/closed/<track>/` | the notes of a closed track, moved there from its worktree's `.temp/` (build output is deleted with the worktree) | `track_close`, the service |
| `<repo>/.temp/tally/state/` | sessions, claims and locks, only for a repository served alone with `--repo` | the server |

The service keeps its live state in its own data volume, outside every repository.

- `repo_configure` refuses a `worktreeRoot` that is not `.temp` or under it (`.temp/lanes` is fine, `lanes` is not). A config written earlier that holds another root still reads.
- A run's `TMPDIR` is not moved by default: a Unix socket path past 108 characters would break test suites that open sockets in a nested worktree. A repository that wants it under `.temp/` sets `commands.tmpdir` (`{track}` is replaced), for example `.temp/{track}/tmp`.

### 10.11 Phases, and records committed once per phase

A phase is a stage: a stretch of work with one goal, closed as a whole. The tools say `phase`; the config's `stages` and a milestone's `stage` keep their names.

- **`phase_add({ sessionId, id, name, goal, weight, decision? })`** (operator session) adds a phase to `docs/records/phases.json`. It joins the repository's stages at once, so `milestone_add` takes its id as `stage`. `goal` is a sentence; `decision` is the id of the decision that approved its plan.
- **`phase_list({ state?, sessionId?, repo? })`** answers each phase with its goal, decision, state (`open` or `closed`), how many of its tasks are landed, and `left`: up to ten sentences saying what still stops an open phase from closing, the four kinds in this order: tasks not landed, commits on `main` the ledger does not record, gaps `ledger_check` lists in the phase's milestones, and landings in the queue. It runs the checks `phase_close` runs and writes nothing. Report `left` to the operator before asking to close a phase.
- **`phase_close({ sessionId, phase, summary })`** (operator session, and only on the operator's word: a phase's end is their gate) refuses, with nothing written, while a task of the phase is not landed, while `ledger_check` lists a commit on `main` no record names, while it lists a gap in one of the phase's milestones (a deliverable no task covers, a wait on a task not in the ledger, a deferred part neither left to a task nor parked, or, where reviews are required, a landed task without a clear review), or while a landing for one of its tracks is in the queue. Otherwise it closes each track tally opened whose tasks all belong to the phase (the way `track_close` does; one that cannot close is named in `tracksLeft` with the reason and does not stop the phase), writes the phase's closing fields, tells every open session in one line (`phase G was closed by <agent>: <summary>`), and commits everything waiting under `docs/records/` as one commit: `records: phase G closed, <n> record files`, with the summary as its body. The answer carries `withoutBuildLog`, the phase's milestones with no build-log section, for a project that keeps one: told, never refused, and left out when every milestone has one. Whether a project records a phase's close in its build log or in its plan is that project's rule. If a landing has its turn the commit waits (`waits`) and is made after it. If the commit fails the phase stays closed and `problem` carries git's words.
- **A closed phase stays closed.** `milestone_add` and `task_plan` refuse it: later work goes in a new phase.
- **`records_commit({ sessionId, why })`** (operator session) commits what waits now, for the day the operator pushes in the middle of a phase. Its subject says how many files and why, when that fits in 70 characters; a longer one is cut at a phrase, and the whole sentence goes first in the commit's body. Every records commit keeps its subject to 70 characters this way. With nothing waiting it answers `{ commit: null, files: 0 }`. It is refused where `records.commit` is false.
- **What waits is visible:** `ledger_check` and an operator session's brief answer `recordsWaiting: { files, since }`, and `session_close` answers `records`, a sentence saying what happened to the records under the repository's mode.

**When records are committed** is one of four modes, read from `records.commit`, `records.batch` and the new `records.commitAt`:

| `commit` | `batch` | `commitAt` | mode | records are committed |
| --- | --- | --- | --- | --- |
| `false` | any | any | `never` | never by tally |
| `true` | not `true` | any | `each` | at each write |
| `true` | `true` | absent | `rest` | when the last session closes, when a landing finishes, and on a write with no session open |
| `true` | `true` | `"phase"` | `phase` | only by `phase_close` and `records_commit` |

A repository added in the sidebar starts in `phase` mode. A repository already tracked keeps its setting until its own operator session changes it with `repo_configure`. A records commit still waits while a landing has its turn and is made under the landing lock.

### 10.12 Reviews

A review is a record of its own, in `docs/records/reviews.json`, not a run of kind `evidence`.

- **`review_record({ sessionId, milestone, task, commit, reviewer, verdict, blocking, findings?, summary, follows?, report? })`** records one. `commit` is what the reviewer read (a hash or a ref, read in your worktree). `reviewer` is who reviewed, not the agent that built the work. `verdict` is `land` (nothing blocks), `fix` (land once the blocking findings are fixed), `stop` (not as built) or `waived` (this task needs no review; an operator session's alone). `blocking` is 0 for `land` and `waived`, at least 1 for `fix` and `stop`. `findings` counts in your own words, such as `{ medium: 1, low: 7 }`. `follows` names the review this one follows up, for the same task. `report` is a file in your worktree or under `.temp/`, kept by its path and hash.
- **A task's state** is its newest review's: `none`, `clear` (`land` or `waived`) or `open` (`fix` or `stop`).
- **`review_list`** answers reviews newest first, and, where reviews are required, `needing`: the landed tasks without a clear review.
- **Turning reviews on** is the operator's: `repo_configure({ config: { reviews: { required: true } } })`. `from` is filled with the present time, so only tasks landed from then on count. With reviews required, a landed task without a clear review is a gap in `ledger_check`, shows in the board's notes, and stops `phase_close`. A landing is never refused for it; `land_start` only says so in the ticket's `note`.

### 10.13 Parked parts

A deferred part is left to a task (`to`), or parked: `{ what, parked: { why, decision?, owner? } }`. Parking says "not now, on purpose". A parked part is no gap, does not make its task landed in part, and does not stop `phase_close`; the board's notes say `<task>: <n> parked`.

- **Who parks:** an operator session, or a session that may write the task and names a decision in the record. A lane with a leftover it cannot place sends `{ what }` alone, and the operator places it.
- **`deferred_list`** answers every part with its place in its task's list (`part`, from 1) and its state: `unplaced`, `waiting` (its task has not landed), `done` or `parked`. `counts` is over the whole ledger.
- **`deferred_set({ sessionId, milestone, task, part, to | parked })`** moves one part to a task or parks it, and answers it as it was and as it is.

### 10.14 Brief levels

`session_open` takes `brief`: `full` (the default), `work` or `land`.

| | `full` | `work` | `land` |
| --- | --- | --- | --- |
| for | the first session of a conversation | reopening to keep building | opening only to land or to record |
| project | whole | name and purpose | left out |
| rules | id, section, title and text | id, section and title | left out |
| `rulebook` | `{ rules, changedAt }` | the same | the same |
| your tasks | with their briefs and paths | the same | milestone, id, claim and wait |
| hand-off, entries that apply | yes | yes | left out |
| who else is working | yes | yes | yes |
| open questions | yes | yes | left out |
| what the context lacks | yes | left out | left out |
| operator: rules to tailor | yes | left out | left out |
| operator: records waiting, checkout | yes | yes | yes |

A level below `full` leaves the rules' text out. Ask for one only when this conversation already holds the full brief, and read `rulebook_get` again when `rulebook.changedAt` is later than the one you hold.

### 10.15 Question ids

A question's id is `Q-<number>` (`Q-24`), computed from its row. `question_add` answers it, `question_list` puts it on every row, and an id is read as `Q-24`, `Q-024` or `24` wherever one is taken; `tally question answer 24` works as before.

- **A plan's own numbering.** An operator session's `question_add` may give `number`, at or above the next one, so tally's ids line up with a plan's. The numbering may jump forward, never back.
- **`question_edit({ sessionId, id, question?, meanwhile?, why })`** corrects an open question. It is for an operator session, or the agent that asked it on the same track. The question keeps what it said before in `edits`; `question_list` says `edited` and, with `history: true`, gives the edits. An answered question is refused: ask a new one that names it. From a shell: `tally question edit Q-24 --question T --why W`.

### 10.16 Cycles

A repository's work runs in numbered cycles; the current one is what `docs/records/` holds.

- **When it is complete.** Once a milestone is finished and nothing would stop a close, `cycle_list`, `board_get` (`cycle`) and an operator session's brief say "everything planned in cycle <n> has landed: ask the operator whether to close it". Ask; tally closes nothing by itself.
- **Closing.** `cycle_close({ sessionId, summary, said, name?, decision? })` is an operator session's, on the operator's word: put their own words, quoted, in `said`. It is refused, changing nothing, while a landing is queued, main holds a commit the ledger does not record, a milestone with landed work is not finished, a track you opened is neither waiting on work not started nor closable, a milestone not started sits in a closed phase, or nothing is finished; `cycle_list` names each blocker. The finished work moves to `docs/records/cycles/cycle-<n>/`, the tracks that can close are closed, and one commit is made: "records: cycle <n> closed".
- **What stays.** Milestones not started, with their planned tasks; open tracks, open phases and the closed stages the config lists, and open notes; every decision, question, rule and context entry; every counter, so the next review or note takes the next number. A milestone's id is never used again: `milestone_add` refuses one a closed cycle holds.
- **Reading a closed cycle.** `cycle_list` with `n` answers it whole. `board_get`, `evidence_list`, `review_list`, `handoff_read`, `track_list`, `phase_list`, `activity_get`, `note_list` and `deferred_list` take `cycle` and answer as that cycle was at its close. The Cycles page shows them too.
- **Before the first close.** An older build of tally (0.6.1, or a host command line built before 0.7.0 that writes the records beside the service) reads what 0.7.0 writes but drops a deliverable's `dropped`, a track's `widened` and a run's `label` and `scope` when it next writes their file, does not see closed cycles, and does not refuse a milestone id a closed cycle holds. Ask the operator to rebuild the host's command line, or point it at the service with `TALLY_URL`, before you use these.
- **While a close runs.** A write you make meanwhile waits for the file it needs and is kept, in the current cycle or the closed one, never lost.
- **An interrupted close** is finished by the next tool call on the repository, the next writing command or the service's next pass. Until it can be, a tool or command that writes is refused with "a cycle close is being finished: try again in a moment", or with the reason it could not be finished: wait a moment and call again, and tell the operator if the reason repeats. Reads still answer.

### 10.17 Changing a milestone or a track

- `milestone_edit` (operator): a new `name`, a `waits` line (null clears it), or `drop: [{id, why, decision?}]`, deliverables that will not be built, which `ledger_check` then no longer lists. A deliverable a landed task covers cannot be dropped.
- `milestone_remove` (operator): a milestone with no landed, claimed or queued task goes with its planned tasks; its run records stay, and the tracks that waited on it are told.
- `track_edit` (operator, or a session of the track's parent): `addPaths` widens a track `track_open` made, no wider than its parent; `purpose` replaces its line.
- `track_open` and `track_edit` answer `declared`: the open tracks whose declared paths overlap this one's. Nothing is refused for it; agree an order before you both change a file.
- `track_close` with `endSessions: true` ends the track's sessions that hold no claim, but only when nothing else stops the close: a commit not landed, uncommitted work, a queued ticket or an open child refuses first, and no session is ended.

### 10.18 A review's own text

`review_record` takes `text`, the whole review, at most 20,000 characters, in place of a `report` file: tally keeps it as `.temp/tally/reviews/<review id>.md` in the repository and records that file as the report. `summary` is still required.

### 10.19 What tally counts

tally counts the calls each tool receives, and nothing else: per tool, the calls, those refused, cut or refused by the schema, the days with a call, and the calls by scope and repository. No argument, answer or session id is kept, and nothing of it is in git. A `usage.json` that cannot be read never stops a server: it is set aside beside itself under a dated name and counting starts again. `tally usage` prints the ranking (`--json` for the data; with `TALLY_URL` it asks the service), `GET /api/usage` answers it, and the Overview page shows "Tools by use", with the tools never called and the characters they cost in every session's tool list.

