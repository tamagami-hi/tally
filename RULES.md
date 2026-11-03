# Rules of the harness

What tally enforces, and what it promises. The tracked repository's own rules govern its work; these govern the records.

1. **`docs/records/` is written by the harness alone.** The ledger, the hand-offs, the evidence and the config are JSON records that change only through tally's verbs (the CLI, the MCP tools, or a script that was cut over to them). A hand edit is a bug.
2. **Progress is counted from `ledger.json` and from git, and from nothing else.** A task is landed when its commit is on main. `ledger_check` lists the commits on main no record names; a landing is finished only when it lists nothing.
3. **One home per fact.** A status, a count or a note is stored once and shown many times: the board, the terminal status, the context packs and the markdown views are computed, never copied.
4. **A session binds to one worktree and one track.** The path must be the track's worktree on the track's branch. A track session writes only its track's tasks, evidence, hand-off and claims; an operator session (the repository's checkout on its main branch) may write any track. Every session reads everything.
5. **Claims and locks are live state, not history.** They live under `.temp/tally/state/`, never in git, and die with their session. One task per session; one session per task; a lock is held by one session, released by the holder or with the session; a lock's name must be in the config.
6. **A run record is written once, with its log's hash.** The log stays where it fell, inside the session's worktree; the harness never edits, moves or deletes a log. A report cites records by id.
7. **Records commits are the harness's own.** Each change to a record is saved on main at once as a docs-only commit prefixed `records:`, made with the configured identity, under the landing lock, so it never moves main under a landing in flight. The check and the status pass over them by their prefix.
8. **Schemas change additively.** Every record carries `"schema": 1`; a reader refuses a schema it does not know and names it; a field is added in one release and removed only after the readers tolerate its absence.
9. **The landing refuses what it cannot vouch for:** the operator's checkout off its main branch or dirty outside `docs/records/`, a worktree off its track's branch, staged files the landing was not told about, uncommitted work without a message, a verification fingerprint that no longer matches, tests that fail, and main that moved while the landing ran. A refused landing changes nothing.
10. **The harness never pushes, deploys, reads a `.env`, runs `sudo`, removes a worktree or deletes anything under `.temp/`.** It commits records, lands by fast-forward and runs the commands it is told to run in the worktree it is bound to. Pushing is the operator's.
11. **Loopback only.** The server and the MCP endpoint listen on `127.0.0.1`; the one trust is the worktree binding; the machine is the operator's.
12. **Small files, tests first, no comments in source.** Source and test files stay under 400 lines; a behaviour is written with the test that sees it fail first; names carry the meaning comments would.
