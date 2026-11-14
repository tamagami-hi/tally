# Tally: landings refused early, commands run in the agent's shell, reviews as records, parked parts, brief levels and question ids

**Written:** 2026-11-14 11:50 IST (2026-11-14 06:20 UTC)
**Base:** `main` at `9f92710` (1,301 tests, 62 MCP tools, version 0.1.0).
**Status:** a plan. Nothing in it is built.
**Checked:** against the MCP builder skill on 2026-11-14; §11 is what that check added.
**Follows:** `2026-11-14-0312-rulebook-phases-worktrees-plan.md`, which is built. This plan answers the review written after the first phase that ran on that build.
**This repository is public.** This file names no private project. Keep it that way when you edit it: the private names and paths are in the local notes, which git ignores.

## 1. Where this comes from

A coordinating agent ran one more phase in the second tracked repository on the upgraded tally: five parallel lanes, one of them built by a second account, five independent reviews, 19 code commits through the landing queue, and one agent cut off by a usage limit in the middle. Its verdict was that tally is now worth it for parallel builds: no lost work, no collisions, hand-offs that let another agent finish, a rulebook the agents cited by number, tracks that cleaned up after themselves, and one records commit for the phase.

It also listed what still hurt. The operator asked for the next plan from that list. The review's own order of importance was:

1. Refuse a landing early, and name the files that stop it.
2. Make `evidence_run` work where the project's tools are.
3. A review as a record type, with a ledger check against it.
4. A deferred part that can be parked on a reason or a decision.
5. Brief levels.
6. Question ids, and questions that can be edited.

Parts A to F take those six in that order. Part G holds the smaller points: a client that cannot see new tools, a view of what is really uncommitted in the operator checkout, and three answers whose wording did not say enough. §14 lists what the review asked for that this plan leaves out, and why.

What was measured in the second repository's records, to check the review before planning (read only):

| the review said | what the records show |
| --- | --- |
| a landing failed after its checks with "operator checkout has changes; left untouched" | `checkCheckout` runs when a ticket gets its turn and again after its checks pass. The message names no file. The file was edited in the operator checkout while the checks ran. |
| `evidence_run` exits 127 | Two run records of that phase have exit 127: one `sweep`, and one `red` that was filed as `other`. The command was the project's own container wrapper, which calls a program the service's image does not have. |
| reviews are stored as evidence | Ten records of kind `evidence` hold a review each. Their `summary` carries hand-made keys: a verdict, a blocking count, counts by severity and the reviewer. |
| 17 gaps for deferred parts | All 24 deferred parts now name a task. Twelve of them, from five landed tasks, point at one standing task in a catch-all milestone. That task is not meant to land, so those five show as "landed in part" for good. |
| the brief is about 12 KB | Ten rules in force are 5,150 characters as the brief sends them; the project record is 1,631; 25 findings are listed by title; a hand-off holds up to 60 lines. |
| questions have no ids | The open question is row 23 in tally. The project's plan calls the same question by a number of its own. |

## 2. Read this before building

- **The standing rules** are in the local notes: `CLAUDE.local.md` and the file it includes. Neither is in git. The ones that bite here:
  - Commit with the repository's one identity, which the local notes give, and with no attribution line. Never push.
  - Never start `tally serve` and never recreate the Docker service. Ask the operator each time.
  - Never edit another repository's files from this checkout.
  - A design change goes in `DESIGN.md`, with generic names, and in the private copy of the design that the local notes name.
- **The house rules** are `RULES.md` rule 12: the test first, seen failing on its assertion; no comments in TypeScript source; source and test files under 400 lines; immutable updates; errors as `TallyError`.
- **How a change is built here:** cut a worktree from `main` under `.temp/worktrees/<name>`, run `npm ci` in it, build with tests first, get an independent review (`ecc:code-reviewer` or `ecc:typescript-reviewer`), fast-forward `main`, then remove the worktree and its branch. The suite is `npm test`; the types are `npm run typecheck`. Under load a test can time out at 5 s: rerun it alone before believing it.
- **Stored formats stay readable by the previous release** (`RULES.md` rule 8). Every schema change below is an optional field or a new file.
- **Part A changes `RULES.md` rule 9**, which today says a landing is refused while the operator checkout is "dirty outside `docs/records/`". That is the operator's rule to change: see decision 1.
- **Before the operator pushes,** scan the tracked files and every new commit message for the private words the local notes list.

## 3. Decisions the operator may want to change

The builder builds the recommended answer unless the operator says otherwise.

| # | question | recommended |
| --- | --- | --- |
| 1 | Which uncommitted files in the operator checkout stop a landing? | **Only the files the landing changes.** Git's fast-forward already refuses to write over an uncommitted file, and no other file can be harmed by it. Today any uncommitted file stops every landing, which is how an edit to a plan cost a lane its four-minute check. The other choice keeps today's rule and only moves the check earlier and names the files; it is one function to switch (§4.2). |
| 2 | Where does a project's command run when tally is the Docker service? | **Always in the agent's own shell, through the runner.** The image has node, git and a shell and nothing else, so a project command either is not found or runs with the wrong tools, and a record made there is not about the project. The other choice, giving the container the host's Docker socket, makes the container root on the host, and is not planned. |
| 3 | Does a landing wait for a review? | **No. A missing review is a gap in `ledger_check` and stops `phase_close`; `land_start` only says so.** Some projects review before landing and some after. The check is off until a repository turns it on. |
| 4 | Who may park a deferred part? | **An operator session, or any session that names a decision.** Parking says "not now, on purpose", which is the operator's call unless a decision already made it. |
| 5 | What is the brief's default level? | **`full`, as today.** A lower level leaves the rules' text out, and that must be asked for, never assumed. |
| 6 | What does a question's id look like? | **`Q-<number>`, without padding (`Q-24`).** `Q-024` and `24` are accepted wherever an id is read. |
| 7 | Do waiting records stay in the working tree during a phase? | **Yes.** Part G gives a view of what is uncommitted apart from the records, and Part A stops the records' presence from costing a landing. Hiding them from `git status` is left out (§14). |
| 8 | Does the version move? | **Yes, to 0.3.0**, with 0.2.0 given to the tools the last build added. Part G uses the version to tell a client its tool list is old. |

## 4. Part A: a landing the operator checkout would stop is refused before any check runs

### 4.1 What exists today

- `checkCheckout` (`packages/core/src/land/checks.ts`) refuses when the operator checkout is off its main branch, or when `git status` shows any path outside the records folder. Its message is "operator checkout has changes; left untouched" and names no path.
- It is called in three places: when a ticket gets its turn (`prepare` in `land/turn.ts`), after the ticket's checks have passed and right before the fast-forward (`settle`), and in `land_run` (`land/run.ts`).
- `land_start` (`joinQueue` in `land/queue.ts`) does not look at the operator checkout at all.
- So a file edited in the operator checkout while a lane's checks run fails that lane after the checks, with no file named. A coordinating agent edits its plan in that checkout all phase.
- `git merge --ff-only` refuses by itself when a file it would write has uncommitted changes, or when an untracked file is in the way. Any other uncommitted file is untouched by it.

### 4.2 The change

One rule, applied at every point where a landing meets the operator checkout: **a landing is stopped by an uncommitted file in the operator checkout only when the landing changes that file**, and the refusal names the files.

- `operatorChanges(repo)`: the paths with uncommitted changes in the operator checkout, the records folder left out. It reads `git status --porcelain=v1 -z --untracked-files=all`, so a path with a space and a rename are read correctly. `entriesOf` in `tracks/close.ts` already parses that form: move it to `git/status.ts` and use it from both.
- `blockingChanges(changes, landing)`: the members of `changes` that are among the files the landing changes. **This one function is decision 1.** To keep today's rule it returns every change.
- `checkCheckout(repo, landing)` keeps the test that the checkout is on main, and says which branch it is on when it is not. It then refuses with: `the operator checkout at <root> has uncommitted changes in <n> file(s) this landing changes: <names>; commit or stash them there, then land again`. Names go through `namedList`, which already caps a long list.
- Where the landing's files come from:

| where | the landing's files | on a refusal |
| --- | --- | --- |
| `land_start` (`joinQueue`) | the files named in the call, with `git diff --name-only -z <main>...<track branch>` | no ticket is made |
| a ticket's turn (`prepare`) | `git diff --name-only -z <base>..<rebased>`, read after the rebase | the ticket fails before its script is written, and its commit is undone as today |
| after the checks (`settle`) | the same range, kept on the turn | the ticket fails; the message adds `its checks passed, so land again once those files are committed or stashed` |
| `land_run` | its own range | as today, with the names |

- `land_start` also refuses at once when the operator checkout is not on main, instead of leaving that to the ticket's turn.
- `RULES.md` rule 9 is reworded to match: "the operator's checkout off its main branch, or holding an uncommitted change in a file the landing changes".

### 4.3 Files and tests

- Changed: `land/checks.ts`, `land/queue.ts`, `land/turn.ts`, `land/run.ts`, `tracks/close.ts`. New: `git/status.ts`.
- Tests, each first and each in a real temporary repository as the landing tests already are:
  - an uncommitted file the landing does not change: the landing lands, and the file is as it was;
  - an uncommitted file the landing changes: `land_start` refuses, the queue is empty, and the message names the file and the checkout's folder;
  - an untracked file at a path the landing adds: refused the same way;
  - a file made dirty while the checks run: the ticket fails at `settle`, names the file and says the checks passed;
  - a renamed file and a path with a space are named correctly;
  - record files alone never stop a landing;
  - the operator checkout off main is refused at `land_start` and the message names the branch.

## 5. Part B: a project's command runs in the agent's shell, and a run that could not start is never evidence

### 5.1 What exists today

- `evidence_run` (`runEvidence` in `records/run.ts`) starts the command inside the service's own process, with the service's environment and the config's `commands.env`.
- The service's image holds node, git and a shell. Its root is read-only. A project command that needs anything else exits 127 there, and `keepRun` records that run as evidence. A `red` that exits 127 is filed as `other`.
- A command the image does have, such as `npm test`, would run with the image's toolchain, not the project's. That record would look real and would not be.
- The runner (`.temp/tally/run`, written by `session_open` and `track_open`) is the way that already works: the command runs in the agent's shell, its result is left in a folder, and the service records it on its next tick, two seconds at most.
- When the service refuses a runner's result, for example one that names no task, it moves the result to `results/refused/` with a `problem` file. Nobody is told: the watcher drops what `takeResults` returns.
- `land_run` runs a track's tests inside the service too.

### 5.2 The change

1. **The service knows whether it may run a project's commands.** The environment variable `TALLY_COMMANDS` is `service` (the default, today's behaviour, for the CLI, stdio and a service run on the host) or `agent`. The image sets `ENV TALLY_COMMANDS=agent`. One function in core reads it; nothing else looks at the environment for this.
2. **With `agent`:**
   - `evidence_run` checks the task as today, then runs nothing and records nothing. It answers `ran: false`, with `run`, the exact runner line for the command it was given, and `why`: the service runs in a container without the project's tools; run the line in your own shell; the runner records it, and `evidence_list` shows the record a few seconds later. The line is built with `quoted` from `land/runner.ts`, so an argument with a space or a quote survives.
   - `land_run` refuses: this service does not run commands; land with `land_start`, which commits, rebases and hands you a script to run in your own shell, then `land_wait`.
   - Both tools are registered with a description that says this, so the list tells the truth for the server it comes from.
3. **With `service`,** `evidence_run` runs as today, with two changes. A program that is not found (`ENOENT` from the spawn) is refused in plain words, with the runner line. A run that exits 126 or 127 is not recorded: the answer has `recorded: false`, and `problem` says that the shell could not find or could not run a program, gives the log's last line, and gives the runner line.
4. **A run that exited 126 or 127 is never evidence, by any path.** One guard in `records/evidence.ts` serves `evidence_run`, `evidence_record` and the runner's results. The runner script also catches it first: on 126 or 127 it removes its result folder, prints `tally: not recorded: exit 127 means the shell did not find a program (126: it could not run it); fix the command and run it again; the log is <log>`, and exits with that code.
5. **A refused runner result is told.** When `takeResults` refuses a result, tally leaves a note for that track (`noteFrom`, as the idle close does), saying which run was not recorded, why, and where the result is kept. The agent reads it in its next tool reply.

The two junk records the phase left stay as they are: a record is never edited.

### 5.3 Files and tests

- Changed: `records/run.ts`, `records/evidence.ts`, `records/results.ts`, `land/runner.ts`, `packages/mcp/src/tools/records.ts`, `Dockerfile`. New: one small module for the switch.
- Tests: the runner script run with `sh` against a missing program leaves no result folder, prints the line and exits 127; `evidence_run` with `agent` answers `ran: false`, writes nothing to the evidence file, and its `run` line, executed against a stub runner, hands back the same arguments, including one with a space and one with a quote; `land_run` with `agent` is refused and names `land_start`; `evidence_record` refuses exit 127; a refused runner result leaves one note for its track; with `service`, exit 127 answers `recorded: false` and the evidence file is unchanged.
- The private end-to-end driver, which runs against the image, gains a step: `evidence_run` answers `ran: false` and the line it gives records a run.

## 6. Part C: a review is a record

### 6.1 What exists today

- There is no review record. The phase stored ten reviews as run records of kind `evidence`, with the verdict and the counts in hand-made `summary` keys.
- The rulebook template has a rule about reviews (`review-once` in `context/rulebook-template.ts`), so a review is not one project's idea.
- Nothing can answer "did every landed task get its review, and were its blocking findings followed up?"
- The ledger does not store when a task landed.

### 6.2 The record

A new file, `docs/records/reviews.json`: `{ schema: 1, nextId, reviews: [] }`. One review:

| field | meaning |
| --- | --- |
| `id` | `review-<n>`, given by tally |
| `milestone`, `task`, `track` | the task whose work was reviewed, and that task's track |
| `commit` | the commit the reviewer read. It must resolve in the repository when the review is recorded; it is stored as a short hash. A rebase may leave it unreachable later, and that is fine: it says what was read. |
| `reviewer` | who reviewed, at most 120 characters: a model, an account or a person. Not the agent that built the work. |
| `verdict` | `land` (nothing blocks), `fix` (land once the blocking findings are fixed), `stop` (do not land as built) or `waived` (this task needs no review) |
| `blocking` | how many findings must be fixed: 0 for `land` and `waived`, at least 1 for `fix` and `stop` |
| `findings` | optional counts in the project's own words, such as `{medium: 1, low: 7}`; at most 8 keys |
| `summary` | what it found, at most 1,000 characters. For `waived`, why no review is needed. |
| `follows` | optional: the id of the review this one follows up, for the same task. A follow-up reads only the fix commits. |
| `report` | optional: the review's full text as a file in the session's worktree or under the repository's `.temp/`, kept as `{path, sha256, bytes}` the way a log is |
| `by`, `at` | the session that recorded it, and when |

Writing rules: the task is planned in the milestone; the session may write for the task's track, or is an operator session; `waived` is an operator session's alone and has no `follows`; a `follows` names a review of the same task that is not `waived`.

**A task's review state** is decided by its newest review: `none`; `clear` when that verdict is `land` or `waived`; `open` when it is `fix` or `stop`.

### 6.3 The check

- `config.reviews` is optional: `{ required: boolean, from?: ISO time }`. `repo_configure` fills `from` with the present time when `required` becomes true and no `from` is given. A repository that never sets it sees no change.
- A task gains an optional `landedAt`, stamped by `recordTask` (`land/record.ts`) when the task is recorded as landed. A task from before this release has none.
- With `required` on, a landed task whose `landedAt` is at or after `from` is a gap when its state is not `clear`:
  - `none`: `<milestone> '<task>' landed with no review: record one with review_record; if it needs none, an operator session records the verdict waived with the reason`
  - `open`: `<milestone> '<task>' has <review id> with <n> blocking finding(s) and no later review: record the follow-up with review_record (follows: <review id>)`
- These are ordinary gaps. `ledger_check` lists them, the status summary shows them in the milestone's notes (where "landed in part" is shown, in `owedNotes`), and `phase_close` is stopped by them through `blockersOf`, which already stops on a gap in the phase's milestones. `findGaps` stays a pure function of the ledger; a second function reads the reviews, and `checkLedger` and `contextOf` join the two.
- `land_start` with a milestone and a task, in a repository where reviews are required: when the task's state is `none` or `open` the ticket carries a `note` that says so. It is not a refusal (decision 3).
- The task-level context pack (`context/records-pack.ts`) names the task's reviews by id, verdict and blocking count.

### 6.4 The tools

- `review_record`: `sessionId`, `milestone`, `task`, `commit`, `reviewer`, `verdict`, `blocking`, `findings?`, `summary`, `follows?`, `report?`. It answers the review, the task's state after it, and the records commit.
- `review_list`: `milestone?`, `task?`, `track?`, `state?` (`open` or `clear`), `limit` (20 unless said, 200 at most), `fields`, and the usual `sessionId` or `repo`. It answers the reviews newest first, `matched`, and, where reviews are required, `needing`: the landed tasks whose state is not `clear`, at most 20 named, with the total.

### 6.5 Files and tests

- New: `schema/reviews.ts`, `records/reviews.ts`, `ledger/review-gaps.ts`, `packages/mcp/src/tools/reviews.ts`. Changed: `schema/ledger.ts` (`landedAt`), `schema/config.ts` (`reviews`), `land/record.ts`, `ledger/audit.ts`, `phases/blockers.ts`, `status/summary.ts`, `context/records-pack.ts`, `land/queue.ts` or `turn.ts` for the note, `meta.ts`, `params.ts`.
- Tests: each writing rule refuses with a sentence that says what to do; a follow-up with `land` turns `open` into `clear`; a task from before `from`, and one with no `landedAt`, is never a gap; with `required` off there is no gap and no note; `phase_close` is refused on a task with no review and passes after a waiver; an operator-only waiver is refused for a track session; the ledger written by this release is read by the previous schema (the new fields are optional).

## 7. Part D: a deferred part can be parked

### 7.1 What exists today

- A deferred part is `{what, to?}` (`schema/ledger.ts`). `ledger_check` reports a part with no `to`, and a part whose `to` is not a task in the ledger. A landed task with a part whose task has not landed shows as "landed in part" (`unfinished` in `ledger/gaps.ts`, used by `status/summary.ts`).
- There is no way to say "this is left on purpose". The phase ended with 17 such gaps, and the coordinator cleared them by pointing twelve parts at one standing task that is not meant to land. Those tasks now show "landed in part" for good, and a real gap would be hard to see among them.
- A task's parts change only as a whole list, through `task_land`.

### 7.2 The change

- A part is left to a task or parked: `{what, to}` or `{what, parked: {why, decision?, owner?}}`. Both together is refused. Neither is a part not placed yet, and stays a gap as today.
  - `why`: at most 200 characters.
  - `decision`: the id of a decision in the record. An unknown id is refused, and the refusal points at `decision_list`.
  - `owner`: who will pick it up, a person or a role, at most 60 characters.
- **Who parks** (decision 4): an operator session; or a session that may write the task and names a `decision`. A lane with a leftover it cannot place sends `{what}` alone, as today, and the operator places it.
- A parked part is not a gap, does not make its task "landed in part", and does not stop `phase_close`. The milestone's notes on the board say `<task>: <n> parked`, so it stays visible without reading as unfinished.
- Each part has a state: `unplaced` (no `to`, not parked), `waiting` (its task is not landed), `done` (its task landed) or `parked`.

### 7.3 The tools

- `deferred_list`: every deferred part in the ledger. Each row has `milestone`, `task`, `track`, `part` (its place in the task's list, from 1), `what`, `state`, and `to` or `parked`. Filters: `state`, `milestone`, `track`, `decision`, `owner`; `limit` (50 unless said, 200 at most). The answer always carries `counts`, the number of parts in each state over the whole ledger, and `matched`.
- `deferred_set`: `sessionId`, `milestone`, `task`, `part`, and exactly one of `to` or `parked`. It answers the part as it was and as it is. The same call made twice leaves the same record.
- `task_land` and `land_start` accept `parked` on a part of `deferred`.
- `ledger_check`'s answer gains `parked`, a count, so the number is visible without being a gap.

### 7.4 Files and tests

- Changed: `schema/ledger.ts`, `ledger/gaps.ts`, `ledger/waits.ts`, `status/summary.ts`, `packages/mcp/src/tools/ledger.ts`, `tools/land.ts`. New: `ledger/deferred.ts`, a tool file if `ledger.ts` would pass 400 lines.
- Tests: a parked part is no gap and no "landed in part"; both `to` and `parked` is refused; a track session parking without a decision is refused and told who may; an unknown decision is refused with the hint; `deferred_set` moves a part from a task to parked and back; `part` out of range names how many parts the task has; `counts` is over the whole ledger whatever the filter; the previous schema reads a ledger with a parked part.

## 8. Part E: the brief has levels

### 8.1 What exists today

`session_open` always answers the whole brief (`sessionBrief` in `context/brief.ts`): the project record, every rule's text, the track's tasks and hand-off, the title of every entry that applies, who else is working, and for an operator session the rules that wait for tailoring and the records that wait. In the second repository that is about 12,000 characters, sent again each time a session is opened only to land a branch.

### 8.2 The change

`session_open` takes `brief`: `full` (the default), `work` or `land`.

| | `full` | `work` | `land` |
| --- | --- | --- | --- |
| for | the first session of a conversation | reopening to keep building | opening only to land or to record |
| project | whole | name and purpose | left out |
| rules | id, section, title and text | id, section and title | left out |
| `rulebook` | `{rules, changedAt}` | the same | the same |
| the track's tasks | with their briefs and paths | the same | milestone, id, claim and wait |
| the hand-off | whole | whole | left out |
| entries that apply | id, kind and title | the same | left out |
| who else is working | yes | yes | yes |
| open questions, `missing` | yes | open questions | left out |
| operator: `tailoring` | yes | left out | left out |
| operator: `recordsWaiting`, `checkout` | yes | yes | yes |

- `rulebook` is new at every level: how many rules are in force and when the rulebook last changed (the newest `at` or `retiredAt` among the rule entries). A session holding an older brief sees that the rules changed and reads `rulebook_get`.
- The description says it plainly: a level below `full` leaves the rules' text out; ask for it only when this conversation already holds the full brief, and read the rules again when `rulebook.changedAt` is later than when you read them.
- The answer names the level it gave (`brief.level`), so a reader knows what was left out.
- `brief.rules` stays whole at `full`, as `TOOL_META` already says.

### 8.3 Files and tests

- Changed: `context/brief.ts` (split by level; it is 131 lines now), `packages/mcp/src/tools/session.ts`, `params.ts`.
- Tests: each level holds exactly the keys in the table; `land` on a fixture with ten rules and a 60-line hand-off is under 1,500 characters; `rulebook.changedAt` moves when a rule is added, tailored or retired; an unknown level is refused and the refusal names the three.

## 9. Part F: a question has an id and can be edited

### 9.1 What exists today

- A question is a row number in `docs/records/questions.json`, given under the file's lock (`records/questions.ts`). `question_add` and `question_list` are the tools; an answer is recorded by the CLI.
- A project's plan numbers its questions itself, so the same question has two numbers.
- A question's text cannot be changed, so it cannot be corrected or made to carry the number the plan uses.

### 9.2 The change

- **The id.** A question's id is `Q-<row>`, computed, never stored. `question_add` answers it, `question_list` puts it on every row, and its `ids` filter accepts `Q-24`, `Q-024` and `24`. The CLI's `question answer` accepts the same. Commit subjects and notes say `Q-24`.
- **Lining up with a plan.** `question_add` takes an optional `number`, in an operator session only. It must be at or above the next number: the numbering may jump forward and never goes back or reuses one.
- **Editing.** `question_edit`: `sessionId`, `id`, `question?`, `meanwhile?`, `why` (at most 200 characters). At least one of the two texts is given. The question keeps what it said before in `edits`: `{at, by, question, meanwhile, why}`, oldest first.
  - Who: an operator session, or a session whose agent asked the question.
  - An answered question is refused: it says when it was answered and to ask a new question that names it.
- `question_list` rows carry `edited`, the number of edits, when there are any. `history: true` adds each row's `edits`.
- `question` and `meanwhile` are held to 2,000 characters in `question_add` and `question_edit`. A longer text already in the record still reads.
- The CLI gains `tally question edit <id> [--question T] [--meanwhile T] --why W`, since the first tracked repository uses the CLI for its questions.

### 9.3 Files and tests

- Changed: `records/questions.ts`, `packages/mcp/src/tools/docs.ts`, `packages/cli/src/commands/question.ts`, `params.ts`, `meta.ts`.
- Tests: the three id forms find the same row; `number` below the next one is refused and the refusal gives the next one; `number` from a track session is refused; an edit keeps the old text and the why; an edit of an answered question is refused; an edit by another track's agent is refused; `history` is left out unless asked; a file written with `edits` is read by the previous schema.

## 10. Part G: the smaller points

### 10.1 A client whose tool list is old

A client reads the tool list once per connection. The service was upgraded while the coordinator's client was connected, so seven tools were missing from its list all phase, and it called them by hand over HTTP. The service answers each request alone and holds no stream to a client, so it cannot push a "the list changed" notice.

- Every package's version becomes 0.3.0, and `SERVER_VERSION` is read from the package instead of being a constant, so the handshake carries it.
- `TOOL_META` gains `since` on each tool: `0.2.0` for the seven the last build added, `0.3.0` for this plan's.
- `session_open` and `repo_list` answer `server`: `{version, tools, newest}`, where `newest` names the tools of the two latest versions. The descriptions say: if a tool named in `newest` is not in your list, your client read the list before the service was upgraded; reconnect it.

### 10.2 What is really uncommitted in the operator checkout

In a repository that commits its records once per phase, `git status` in the operator checkout lists the waiting record files all phase, and a real uncommitted edit hides among them.

- `ledger_check` and the operator's brief answer `checkout`: `{branch, changed, total}`, where `changed` is what `operatorChanges` (§4.2) returns, at most 20 paths. `ledger_check`'s text gains one line when there are any.
- The guide gives the one line that shows the same in a terminal: `git status -- . ':(exclude)docs/records'`.

### 10.3 Three answers that did not say enough

- `session_close` keeps `recordsCommit` and adds `records`, a sentence for the repository's records mode: committed as each was written; committed now, with the hash; waiting for the last session to close; `<n> record files wait for the close of the phase (phase_close), or for records_commit`; or committed by hand in this repository.
- `track_close` keeps `cleaned.names` and `cleaned.total` and adds `cleaned.what`: files git ignores under these top-level folders were deleted with the worktree (build output and installed packages); notes under `.temp/` were kept, and `kept` says where.
- The notice that main has a commit the ledger does not record did not fire in the phase, because every commit was recorded at once. Confirm that a test makes it fire and reads its text; add one if none does.

### 10.4 Files and tests

- Changed: `packages/mcp/src/server.ts`, `meta.ts`, `tools/session.ts`, `tools/ledger.ts`, `state/end.ts`, `tracks/close.ts`, every `package.json`, `GUIDE.md`.
- Tests: `newest` holds exactly the tools whose `since` is one of the two latest versions; every tool added from 0.2.0 on has a `since`; `checkout.changed` leaves record files out; `session_close` gives the right sentence in each of the four records modes; `cleaned.what` is present when anything was cleaned.

## 11. The MCP surface, checked against the MCP builder skill

The skill asks for names an agent can find, annotations that are true, inputs with limits and examples, answers that stay small, refusals that say what to do next, short descriptions, and an evaluation. The last plan's §8 holds the rules this server already follows; they apply here unchanged.

### 11.1 Every tool the plan adds or changes

Five tools are new, which makes 67.

| tool | new | title | effect | hints (read-only, destructive, idempotent, open world) |
| --- | --- | --- | --- | --- |
| `review_record` | yes | Record a review | add | no, no, no, no |
| `review_list` | yes | List reviews | read | yes, no, yes, no |
| `deferred_list` | yes | List deferred parts | read | yes, no, yes, no |
| `deferred_set` | yes | Place a deferred part | replace, again | no, yes, yes, no |
| `question_edit` | yes | Edit a question | add | no, no, no, no |
| `session_open` | | | | unchanged; gains `brief`, and `server` in its answer |
| `session_close` | | | | unchanged; gains `records` |
| `repo_list` | | | | unchanged; gains `server` |
| `land_start` | | | | unchanged; refuses earlier; `deferred` parts may be parked |
| `land_run` | | | | unchanged; refused where the service does not run commands |
| `evidence_run` | | | | where the service does not run commands it writes nothing, so it is registered there as a read: yes, no, yes, no |
| `evidence_record` | | | | unchanged; refuses exit 126 and 127 |
| `task_land` | | | | unchanged; `deferred` parts may be parked |
| `ledger_check` | | | | unchanged; gains `checkout` and `parked`, and the review gaps |
| `question_add` | | | | unchanged; gains `number`, answers `id` |
| `question_list` | | | | unchanged; `ids` takes the three forms; gains `history` |
| `track_close` | | | | unchanged; gains `cleaned.what` |

`question_edit` is an `add` because it keeps what the question said before. `deferred_set` replaces a part's placement and keeps no history of it, so it carries the destructive hint.

### 11.2 Inputs

- Every new input object is strict, as the others are: an unknown key is refused by name.
- Every new parameter has a description in `params.ts`, with an example where the form is not obvious: `the review's id, for example review-7`; `the question's id, for example Q-24`; `the part's place in the task's list, from 1, as deferred_list shows it`; `the commit the reviewer read, as a hash or a ref`.
- Limits are in the schema: `reviewer` 120, `summary` 1,000, `why` 200, `owner` 60, question texts 2,000, `blocking` 0 to 999, `findings` at most 8 keys, each `limit` with its maximum.
- Enumerations are `z.enum`, so a wrong word is refused with the right ones: the verdicts, the states, the brief levels.

### 11.3 Answers

- Lists are bounded and say how many matched: `review_list` (20, at most 200), `deferred_list` (50, at most 200). Both take `fields`.
- `review_list` and `deferred_list` are newest first where order means time (`newestFirst` in `TOOL_META` for `review_list`); `deferred_list` is in ledger order.
- `review_list.needing` and `checkout.changed` name at most 20 and give the total.
- `session_open` at `land` is under 1,500 characters; at `full` nothing is added but `rulebook`, `server` and, for an operator, `checkout`.
- A `report` is kept by path and hash, never returned as text.

### 11.4 A refusal says what to do next

Every refusal this plan adds, with its shape:

| when | the refusal |
| --- | --- |
| the operator checkout has an uncommitted change in a file the landing changes | names the folder and the files; "commit or stash them there, then land again" |
| the operator checkout is off main | names the branch it is on; "check out <main> there" |
| `land_run` where the service does not run commands | "land with land_start, which hands you a script to run in your own shell, then land_wait" |
| a run exited 126 or 127 | says what the code means, gives the log's last line and the runner line |
| a review's `blocking` does not fit its verdict | says which numbers each verdict takes |
| `waived` from a track session | "an operator session records a waiver; ask with question_add" |
| `follows` names a review of another task, or none | names the task's own reviews |
| a part given both `to` and `parked` | "a part is left to a task or parked, not both" |
| parking without a decision, from a track session | "an operator session parks a part; or name the decision that covers it" |
| an unknown decision | "decision_list shows the decisions" |
| `part` out of range | says how many parts the task has |
| an edit of an answered question | says when it was answered; "ask a new question that names it" |
| `number` below the next one | gives the next number |
| an unknown brief level | names the three |

### 11.5 Descriptions

- A new tool's description is at most 600 characters; a changed one grows by at most 200. `tools/list` was 70,543 characters at 62 tools: hold it under 77,000 at 67.
- Each description says what the tool is for, what it answers, and what it refuses, in that order, as the others do.
- `evidence_run` and `land_run` have two descriptions each, one for each value of `TALLY_COMMANDS`, and the server registers the one that is true for it.

### 11.6 The evaluation

`evaluations/tally.xml` has ten questions over the fixture that `evaluations/fixture.py` builds. Extend the fixture with reviews, parked parts, an edited question and a question added with a `number`, and replace three of the ten with questions that need the new read tools, each with one stable answer:

- over `review_list`: which landed task still has a review with blocking findings and no follow-up;
- over `deferred_list`: how many parts are parked under one named decision, and who owns them;
- over `question_list` with `history`: what an edited question said first.

Each stays read-only and is answered by the builder by hand before it is kept.

### 11.7 Checks before a part is called done

- `tools/list` over HTTP: every tool has a title, the four hints and a strict input; no parameter lacks a description; an unknown argument is refused.
- The private end-to-end driver, against the freshly built image, passes with 67 tools.
- The evaluation's ten answers still hold.

### 11.8 Where tally knowingly differs from the skill

Unchanged from the last plan: no `tally_` prefix on tool names, no `response_format`, no `outputSchema`, and SDK v1 (`@modelcontextprotocol/sdk`), which receives only fixes; `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` is the migration when the operator wants it. New here: only `question edit` gains a CLI command; the other new tools have none, as the phase tools have none.

## 12. Order, and what done looks like

Build in this order, one part per commit or small run of commits, each with its tests first and its own review:

1. **Part A**, with §10.2, which shares `operatorChanges`.
2. **Part B.**
3. **Part D**, before Part C, because both add gaps and D changes the gap code more.
4. **Part C.**
5. **Part F.**
6. **Part E.**
7. **The rest of Part G**, then the version, the guide, the design and the evaluation.

Done means:

- `npm run typecheck` and `npm test` pass; no source or test file is over 400 lines; no comment in changed source.
- §11.7 holds.
- `GUIDE.md` gains what an agent needs: the landing rule in §10.3, running a check through the runner in §10.2, and new subsections for reviews, parked parts, brief levels and question ids. `DESIGN.md` gains a section for this build, and the private copy of the design gains the same. `RULES.md` rule 9 is reworded (decision 1), and rule 6 says that a run that could not start is not recorded.
- `npm run build` and `docker build -t tally:local .` succeed. The running container is left alone.
- The builder's report says what was built, what differs from this plan and why, and what was not verified.

## 13. Rolling out

1. The operator recreates the service. Before that, check that no session, claim or landing is in flight in any listed repository.
2. Every connected client reconnects, so its list has the five new tools. From this release on, `server.newest` tells a client when that is needed.
3. Nothing changes for a repository until it asks:
   - reviews are checked only after `repo_configure` sets `reviews.required`;
   - a part stays as it is until `deferred_set` moves it;
   - a session gets the full brief unless it asks for less.
4. In the second tracked repository, its own operator session may then: turn reviews on before its next phase; move the parts that sit on its standing catch-all task to parked, each with its decision or owner; and add its next question with the `number` that lines tally up with its plan.
5. The first tracked repository needs no change. Its CLI calls and its records read as before.

## 14. What the review asked for that this plan leaves out

- **Hiding waiting records from `git status`.** Two ways exist. Marking the record files skip-worktree hides changes to tracked files but not new files, and it makes `git checkout`, `git reset` and a pull behave in ways that surprise. Keeping the records in a working copy git does not see changes where every tool reads and writes them, and the first tracked repository's scripts read those files directly. Part A removes the cost the dirty tree had, and §10.2 shows what is really uncommitted. Come back to this if that is not enough.
- **A landing that waits for the operator checkout** instead of failing after its checks. With decision 1 that case needs the operator to be editing the very file a lane is landing. A waiting ticket would hold the whole queue behind it.
- **Pushing "the tool list changed" to clients.** It needs a stream held open to each client, and the service answers each request alone. §10.1 tells the client instead.
- **Making the server choose the brief level,** for example refusing `land` until that agent has had a full brief since the rulebook last changed. It needs a record of who has read what. `rulebook.changedAt` lets the agent see it for itself.
- **The build log as the home of a phase's close.** The phase record already holds the close: who, when and the summary. Whether a project also writes a build-log section or a section of its plan is that project's rule, and its rulebook says which.
- **Refusing a landing that has no review.** Decision 3.
- **A dated build level above phases.** Left out of the last plan, and not asked for again.
