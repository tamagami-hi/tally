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

Four cards along the top give the head of main, the unpushed commits, today's commits and the open questions. Below them the board shows the stages and milestones with their tasks' progress, each milestone naming its configured track and the tracks of its tasks, every live worktree with its branch and uncommitted work (each branch in a colour of its own, `main` first in the one accent, the rest ordered by activity: a live session or claim above an idle branch, then the newest commit or tally event, ties by name), the commit graph (`main` on its heavy lane, a branch ahead of `main` forking off it on a lane in the branch's colour, unpushed commits hollow; it opens at the newest 60 and loads the rest as you scroll, a new commit keeping what is loaded and where you are), the ledger's problems, and who is working: each session on its track, each claimed task, each held lock. It updates over server-sent events whenever a ref, a working tree, the ledger or the live state changes. On a 16:9 screen it is three columns; on a 9:16 phone it is one page at a time behind a bottom tab bar. The Evidence page lists each milestone's run records by task, each log opened in place from where it fell. The Docs page, beside Board and Evidence, lists every document by group with its purpose, then the records: a document opens rendered, links between documents stay in the page, and a JSON record opens as a tree. The same process serves the API (`/api/snapshot`, `/api/status`, `/api/graph?limit=<n>` (`{ commits, total }`, laid out from the top; the snapshot carries the first 60 and `graphTotal`), `/api/ledger`, `/api/config`, `/api/evidence`, `/api/evidence/<milestone>`, `/api/evidence/log/<id>`, `/api/docs`, `/api/docs/read?path=<path>`) and the MCP endpoint (`/mcp`).

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

Any client that speaks streamable HTTP can use the `/mcp` URL instead. One server per tracked repository; the live state is shared through files, so a stdio session and the board agree.

## 4. A session's first minute

1. `session_open` with the absolute path of your worktree, your track's name (from `config.json`) and who you are. The path must be that track's worktree and on its branch, or the harness refuses and says which. The repository's own checkout on its main branch opens an operator session, which may write any track.
2. `context_pack` at your level: `project` (the rules, the milestones, who is working), `track` (your tasks, your current hand-off), `milestone`, or `task` (the task, its evidence so far, the hand-off). Read that instead of ten documents; it is assembled from the records at that moment.
3. `docs_read` for a plan section the pack points at; `docs_search` to find one.

## 5. A task's life

| step | tool |
| --- | --- |
| take the task, so the board shows it | `task_claim` |
| write the failing test, run it | `evidence_run` with kind `red` (the command runs in your worktree with the landing environment; the log is kept under `.temp/<track>/tally/`, its hash in the record). A red must show a failed test: one that exits 0, or exits non-zero with no failed test, such as a compile or usage error, is recorded as `other` with a note saying why, and the result's `notice` says so. The failed count is read from cargo's, vitest's and pytest's output; for another runner, use `evidence_record` with `summary.failed` |
| make it pass, lint, format | `evidence_run` with `green`, `clippy`, `fmt` (or `evidence_record` for a run you made yourself); a command that ran always answers with what ran, and `recorded: false` with `problem` says the record could not be written, the log being kept all the same |
| land it on main | `land_run` with the explicit files and the commit message file: rebase, the configured tests, a commit as the operator, a fast-forward; refused when the checkout is dirty, the branch is wrong, files are staged that you did not name, or main moved under you. With `commands.landing` in the config the commit comes first and every commit ahead of main is tested in a clean checkout (section 7); the result's `log` holds their output, and a failure names the commit and that log. With `milestone` and `task` it records that task at the hash it made, the landing's earlier commits in `also`, and releases the claim, an unplanned task being added as `task_land` adds it (from the shell, `tally land <track> --message F --milestone M --task T <paths...>`). A landing that succeeds but cannot record says so with the commit, and is still a landing |
| record a landing made without them | `task_land` or `tally task land` with the commit (and `also` for follow-ups); the claim is released, whoever holds it, since a landed task cannot be worked |
| leave what the next session cannot find in the commits | `handoff_write` (at most 60 lines) |
| wait on something | `task_wait`, cleared by `task_unwait` (`tally task unwait <milestone> <task>`); a commit that is no task's: `task_other` |
| drop a task that will not be done | `task_remove` with `why` (`tally task remove <milestone> <task> --why REASON`): for a task planned by mistake, split into others, or dropped. A landed task stays, since it is the record of its commit. It is refused while another session holds the task or a landing in the queue is to record it. The task's run records stay in the milestone's evidence, the tracks whose tasks wait on it are told, and the message says what the removal leaves behind |
| check | `ledger_check` must say the ledger covers every commit on main |

Every change to a record is written to `docs/records/` at once, so the board and every session see it. By default it also becomes a docs-only `records:` commit on main, made by the harness with the configured identity under the landing lock. With `records.batch: true` in the config, the changes wait on disk and go in as one commit: when the last open session closes, or on `tally records commit`, which must run before a push if a session is still open.

A records commit that cannot take the landing lock fails nothing: the change is on disk, the result shows `commit: null`, and the next records commit carries it. `tally records commit` is the exception, since committing is all it was asked to do: it fails and says so. Any other lock that stays held fails with its name and how long it waited, and says nothing was changed.

## 6. A milestone's close

| step | tool |
| --- | --- |
| index the run records a track kept on its own | `tally import evidence <dir> --milestone M --task T [--kind K] [--flat]`: each `*.json` of the shape `{command, cwd, started, seconds, exit}` becomes a record of that task, its kind read from the file name (red, green, clippy, fmt, land, coverage, sweep) unless `--kind` says, its sibling `.log` hashed and left in place, a `red` with no failed test indexed as `other`; a second run indexes nothing twice |
| the code as last verified | `tally checks set --file <record.json>` (the MCP tool `checks_set`), refused unless the record's fingerprint is what `tally checks fingerprint` prints for main (`git log -1 --format=%h <main> -- <the config's code paths>`); `checks get` is the record and `checks render` the Markdown a reader expects |
| the build log's dated section | `tally buildlog append --group G --milestone M --title "T" --date YYYY-MM-DD --file body.md [--commit C]...` (`buildlog_append`), one section per milestone and group; `tally buildlog render --group G` (`buildlog_render`) is the group's log as Markdown |
| a decision built | `tally decision setStatus <id> --group G --status "built in M (<commit>)" [--by WHO]`; adding or replacing a decision is the operator's alone: `tally decision add\|replace <id> --group G --text "..." --since "..." --status "..." [--why "..."] --operator` |
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
- Reading them is cheap: `question_list` returns the open rows and how many were answered, and `answered: true` adds the answered rows; `decision_list` takes a `group` and a list of `ids`.
- Milestones are the operator's: `milestone_add` needs an operator session; `tally milestone add` from the shell is the same.
- `tally status` from a phone over SSH is the terminal view; the board is the same picture live.
- A records commit on main is normal; the check and the status pass over them by prefix.
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
- `brief`, in a repository that keeps its context as records (10.8): the project, every rule, your track's unlanded tasks and its hand-off, the context entries that apply to your track's paths, who else is working, how many questions are open, and what the repository's context still lacks.

`repo_list` lists the repositories the service tracks. A reading tool called with neither a `sessionId` nor a `repo` goes to the default repository: the first one added, unless the operator picked another.

### 10.2 Run a check

The service has git and no toolchain, so you run every command yourself, in your own shell, through the runner:

```bash
.temp/tally/run green --task "B2:4 manifest" -- cargo test --locked
```

- The first word is the kind of run: `red`, `green`, `clippy`, `fmt`, or any other lowercase word.
- `--task MILESTONE:TASK` ties the run to a task, and `--note TEXT` adds a note.
- The command runs with the repository's configured environment. Its output is shown live and kept in a log under the repository's `.temp/tally/logs/<track>/`.
- The script exits with the command's exit code.

Within two seconds the service takes the result in as a run record with the log's hash, and your next tool answer says so under `inbox`. A result it can't accept is set aside, and the inbox says why. `evidence_list` reads the records as before.

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

### 10.4 What the other tracks are doing

- **Overlaps.** The answers of `session_open`, `task_claim` and `land_start` carry `overlaps` when another track has changed a file yours also changes: the file, the track and who is on it.
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

- **`track_open({ sessionId, name, purpose, parent?, paths? })`** makes the branch `track/<name>` at `main`'s tip and a worktree for it under the repository's `.temp/worktrees/` (or the config's `worktreeRoot`), and writes the runner there. The answer carries the absolute `worktree`: start the helper in that folder and have it call `session_open` with it.
  - An operator session opens any track. A track's session opens only a child of its own track, and may then write that child's tasks, evidence and hand-offs.
  - `paths` limits what the track may land. A child takes its parent's `paths` when it names none, and can't go wider.
- **Every track lands on `main`** through `land_start`, child or not. Nothing lands into a parent's branch.
- **`track_close({ sessionId, name })`** removes the track's landing checkout, worktree and branch, and marks its record closed. It is refused, with nothing removed, while the track has an open session, a claimed task, uncommitted work, commits not on `main`, or ignored files tally didn't write. The refusal names them.
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
- **Landed in part.** `land_start` and `task_land` take `deferred: [{ what, to? }]`: the parts that didn't land, and the task that will finish each. The board shows the task as landed in part until those tasks land.
- **The check.** `ledger_check` answers two lists. `scope: "mine"` keeps only your track's.
  - `missing`: the commits on `main` no record names.
  - `gaps`, each a sentence: a deliverable no task covers, a wait on a task that isn't in the ledger, or a deferred part with no task to finish it.

A writing tool's answer carries `done: true` and `records`: the records commit, or `"waiting"` when the change is on disk and goes in with the next records commit.

The list tools take filters, so an answer stays small:

| tool | filters |
| --- | --- |
| `question_list`, `decision_list` | `ids`, `group`, `limit` |
| `evidence_list` | `kind`, `since`, `limit`, `fields` |
| `board_get` | `scope`, `fields` |
| `note_list` | `state`, `since`, `limit`, `everyTrack` |

**An answer is never larger than 25,000 characters.**
- `evidence_list` answers the 20 runs started last unless `limit` says otherwise, and `matched` says how many there are.
- A longer answer from any tool is cut: its longest list keeps its latest items, `truncated` says which part was shortened and from how many, and a last line names the arguments that narrow that tool.
- Answers are compact JSON.

**A tool refuses an argument it doesn't have**, by name, so a mistyped argument is never silently ignored. Every tool also carries a title and hints for the client: whether it only reads, whether it removes or overwrites, and whether calling it twice changes anything.

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
- **The activity log.** Each write a tool makes is one event under `docs/records/log/`: when, the session, its track and agent, the tool and its target. `activity_get({ since?, track?, limit? })` tells a session what happened while it was away.
- **The build log** takes fields: `buildlog_append` with `built`, `verified`, `decided`, `corrected` and `open`, with or without Markdown.

**A new repository's first session.** A repository added in the sidebar has a default config and an empty context. The first operator session's brief lists what is `missing`. That session reads the code, sets the checks with `repo_configure`, and writes the project, its areas, its how-tos and its conventions. Until a check is set, the default one fails by design, so nothing lands unchecked.

### 10.9 The `tally` command

With `TALLY_URL` set (`export TALLY_URL=http://127.0.0.1:47560`), every `tally` command is carried out by the service, so there is one writer. `tally land` joins the same queue as the agents' landings, runs the turn's script in your shell, and waits for the result. Without `TALLY_URL` the command works on the files itself, which is right only for a repository the service doesn't serve.

`tally repo add PATH [--name NAME]`, `remove NAME`, `default NAME` and `list` manage the list of repositories from a shell. The board's sidebar does the same.

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
| `<repo>/.temp/tally/state/` | sessions, claims and locks, only for a repository served alone with `--repo` | the server |

The service keeps its live state in its own data volume, outside every repository.

- `repo_configure` refuses a `worktreeRoot` that is not `.temp` or under it (`.temp/lanes` is fine, `lanes` is not). A config written earlier that holds another root still reads.
- A run's `TMPDIR` is not moved by default: a Unix socket path past 108 characters would break test suites that open sockets in a nested worktree. A repository that wants it under `.temp/` sets `commands.tmpdir` (`{track}` is replaced), for example `.temp/{track}/tmp`.
