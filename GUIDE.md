# Tally: the guide

How to track a build with tally: one repository, one or more agent sessions in parallel worktrees, one ledger counted from git, a live board, and an MCP server that hands each session exactly the context its level needs. [RULES.md](RULES.md) is what the harness enforces; [DESIGN.md](DESIGN.md) is why.

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

Four cards along the top give the head of main, the unpushed commits, today's commits and the open questions. Below them the board shows the stages and milestones with their tasks' progress, every live worktree with its branch and uncommitted work, the commit graph (unpushed commits on the orange lane, hollow), the ledger's problems, and who is working: each session on its track, each claimed task, each held lock. It updates over server-sent events whenever a ref, a working tree, the ledger or the live state changes. On a 16:9 screen it is three columns; on a 9:16 phone it is one page at a time behind a bottom tab bar. The Evidence page lists each milestone's run records by task, each log opened in place from where it fell. The Docs page, beside Board and Evidence, lists every document by group with its purpose, then the records: a document opens rendered, links between documents stay in the page, and a JSON record opens as a tree. The same process serves the API (`/api/snapshot`, `/api/status`, `/api/graph`, `/api/ledger`, `/api/config`, `/api/evidence`, `/api/evidence/<milestone>`, `/api/evidence/log/<id>`, `/api/docs`, `/api/docs/read?path=<path>`) and the MCP endpoint (`/mcp`).

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
| land it on main | `land_run` with the explicit files and the commit message file: rebase, the configured tests, a commit as the operator, a fast-forward; refused when the checkout is dirty, the branch is wrong, files are staged that you did not name, or main moved under you. With `milestone` and `task` it records that task at the hash it made, the landing's earlier commits in `also`, and releases the claim, an unplanned task being added as `task_land` adds it (from the shell, `tally land <track> --message F --milestone M --task T <paths...>`). A landing that succeeds but cannot record says so with the commit, and is still a landing |
| record a landing made without them | `task_land` or `tally task land` with the commit (and `also` for follow-ups); the claim is released, whoever holds it, since a landed task cannot be worked |
| leave what the next session cannot find in the commits | `handoff_write` (at most 60 lines) |
| wait on something | `task_wait`; a commit that is no task's: `task_other` |
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

Each track has its worktree and its branch; each session binds to one. A track that only touches part of the repository can name its own `test` command and its `paths` in the config: its landings run that command in place of the repository's, and refuse any file outside those paths. A track session writes only its track's tasks, evidence and hand-off; it reads everything. A task is held by one session at a time, and a session holds one task at a time. The named locks (`lock_acquire`, `lock_release`, `lock_list`) coordinate what the config says needs one, such as an evidence host; a lock dies with its session. `board_get` with `scope: "mine"` is your slice of the board.

When a task of yours waits on another track, `task_wait` names what it waits for and the board draws it; move to a task that does not wait.

## 8. Operating

- Decisions are the operator's: `tally decision add` and `replace` take `--operator`, and no MCP call enters one; `tally question answer <row> <decision>` answers a question row.
- Milestones are the operator's: `milestone_add` needs an operator session; `tally milestone add` from the shell is the same.
- `tally status` from a phone over SSH is the terminal view; the board is the same picture live.
- A records commit on main is normal; the check and the status pass over them by prefix.
- The old scripts of a repository that was cut over keep working: they hand their command lines to tally.

## 9. Another repository

Copy `examples/three-tracks.config.json`, set the tracks, stages, test command, fingerprint paths and identity, run `tally init --config`, commit `docs/records/`, serve. Nothing in tally knows the first repository's names; everything repository-specific is in that one config.
