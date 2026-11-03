# Tally: the guide

How to track a build with tally: one repository, one or more agent sessions in parallel worktrees, one ledger counted from git, a live board, and an MCP server that hands each session exactly the context its level needs. [RULES.md](RULES.md) is what the harness enforces; [DESIGN.md](DESIGN.md) is why.

## 1. Start

```bash
npm install && npm run build                      # in the tally checkout
node packages/cli/dist/main.js --help             # or put packages/cli/dist/main.js on PATH as `tally`
```

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

The board shows the stages and milestones with their tasks' progress, every branch with its worktree's uncommitted work, the commit graph (unpushed commits on the orange lane, hollow), the ledger's problems, and who is working: each session on its track, each claimed task, each held lock. It updates over server-sent events whenever a ref, a working tree, the ledger or the live state changes. On a 16:9 screen it is three columns; on a 9:16 phone it is one page at a time behind a bottom tab bar. The same process serves the API (`/api/snapshot`, `/api/status`, `/api/graph`, `/api/ledger`, `/api/config`) and the MCP endpoint (`/mcp`).

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
| write the failing test, run it | `evidence_run` with kind `red` (the command runs in your worktree with the landing environment; the log is kept under `.temp/<track>/tally/`, its hash in the record) |
| make it pass, lint, format | `evidence_run` with `green`, `clippy`, `fmt` (or `evidence_record` for a run you made yourself) |
| land it on main | `land_run` with the explicit files and the commit message file: rebase, the configured tests, a commit as the operator, a fast-forward; refused when the checkout is dirty, the branch is wrong, files are staged that you did not name, or main moved under you |
| record the landing | `task_land` with the commit (and `also` for follow-ups); the claim is released |
| leave what the next session cannot find in the commits | `handoff_write` (at most 60 lines) |
| wait on something | `task_wait`; a commit that is no task's: `task_other` |
| check | `ledger_check` must say the ledger covers every commit on main |

Every change to a record becomes a docs-only `records:` commit on main at once, made by the harness with the configured identity under the landing lock, so the ledger is never ahead of or behind git.

## 6. Parallel tracks

Each track has its worktree and its branch; each session binds to one. A track session writes only its track's tasks, evidence and hand-off; it reads everything. A task is held by one session at a time, and a session holds one task at a time. The named locks (`lock_acquire`, `lock_release`, `lock_list`) coordinate what the config says needs one, such as an evidence host; a lock dies with its session. `board_get` with `scope: "mine"` is your slice of the board.

When a task of yours waits on another track, `task_wait` names what it waits for and the board draws it; move to a task that does not wait.

## 7. Operating

- Milestones are the operator's: `milestone_add` needs an operator session; `tally milestone add` from the shell is the same.
- `tally status` from a phone over SSH is the terminal view; the board is the same picture live.
- A records commit on main is normal; the check and the status pass over them by prefix.
- The old scripts of a repository that was cut over keep working: they hand their command lines to tally.

## 8. Another repository

Copy `examples/three-tracks.config.json`, set the tracks, stages, test command, fingerprint paths and identity, run `tally init --config`, commit `docs/records/`, serve. Nothing in tally knows the first repository's names; everything repository-specific is in that one config.
