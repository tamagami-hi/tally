# Tally: cycles, work orders and the operator's word over MCP, and cheaper landings

**Written:** 2026-11-20 21:12 IST (2026-11-20 15:42 UTC)
**Base:** `main` at `5afec07`, version 0.6.1 (1,684 tests in 200 files, 67 MCP tools, `tools/list` 76,551 characters in the image).
**Status:** planned, not built.
**Amended:** 2026-11-20 21:30 IST, at the operator's word, before any part was committed: the limit on `tools/list` stays at 77,000 characters (section 3, row 9, and Part T), and tally counts what is called, so that the operator can remove tools by use at the next upgrade (Part U). Two tools of the first draft became an answer and a parameter (`role_get`, `land_order`).
**Builds as:** three releases in this order, 0.7.0, 0.8.0 and 0.9.0, by one builder on one branch. Each release ends green before the next begins.
**Checked:** against the MCP builder guide on 2026-11-20; section 9 is what that check added.
**This repository is public.** This file names no private project. Keep it that way when you edit it: the private names and paths are in the local notes, which git ignores.

## 1. What this answers

Two reviews by the coordinating agent of the second tracked repository, written after two days of parallel lanes on 0.6.1 (up to 13 lanes open at once, 63 landings, 171 commits), and the operator's own direction, given on 2026-11-20. In the operator's words:

1. **Build sessions.** "the development works in sessions ... i would like to keep those records like build records for that session with a session number ... tally should ask the agents whether they should transfer the records in a session folder and the agent in turn should ask the developer ... tally should have a dedication session page where it will show previous sessions and completed phases and task in one place. only the project context and rules and decision will not be included in sessions."
2. **A coordinator with targeted hand-outs.** "one coordinator agent with all the project context, and delegating task with targeted context, rules, decisions, tasks and all that is required for the build."
3. **The reviews' asks:** "the implementations of the scripts and automation that the agents pointed out in their review, with any upgrades that you think will help."
4. **Solid for agents:** "use mcp builder skill and any skill required to make tally a production grade software for the agents to use."

The first idea is not new to this repository: the first review of the second tracked repository outlined a dated level above phases, and the plan of 2026-11-14 03:12 left it out (its section 3, row 7). It is built here.

What the study behind this plan found, in short:

- A builder's brief carries every rule in force and **no decision at all**. A decision has no paths and no link to a task, so it reaches a builder only through what a coordinator retypes. In the second tracked repository one decision restated a plan's answer in other words, and the two drifted.
- The brief is the small part of what a builder loads. The tool list is 76,551 characters, and 20 of its 67 tools are an operator session's alone.
- Checks chosen by path exist (`commands.checks`), chosen once for a landing and then run for every commit of it.
- A landing can be cancelled only before its turn. A milestone can be added and given deliverables, and nothing else. A track's paths cannot change. A session left open stops `track_close` for four hours.
- The run kinds are `red, green, clippy, fmt, sweep, coverage, land, evidence, other`. Agents asked for `check` and `integration` and were refused.
- A decision is written only from the command line, with `--operator`, which the agent itself types. The server has an operator route for decisions that no page calls.
- After a restart the service runs no watcher for a repository until its board is opened: until then runner results are not taken in and idle sessions never expire.
- A build that rewrites a record drops every field it does not know.

## 2. Read this before building

- **The standing rules** are in the local notes: `CLAUDE.local.md` and the file it includes. Neither is in git. The ones that bite here:
  - Commit with the repository's one identity, which the local notes give, and with no attribution line. Never push.
  - Never start `tally serve` on the service's port and never recreate, stop, retag or restart the Docker service. Ask the operator each time.
  - Never call the live service's MCP tools, and never edit another repository's files.
  - A design change goes in `DESIGN.md`, with generic names.
- **The house rules** are `RULES.md` rule 12: the test first, seen failing on its assertion; no comments in TypeScript source; source and test files under 400 lines; immutable updates; errors as `TallyError`.
- **How a change is built here:** in the worktree cut for it under `.temp/worktrees/`, on its own branch, after `npm ci` there. Never in the main checkout, and never by moving `main`. The suite is `npm test`; the types are `npm run typecheck`. Under load a test can time out at 5 s: rerun it alone before believing it.
- **Stored formats stay readable by the previous release** (`RULES.md` rule 8). Every schema change below is an optional field or a new file, with one exception that section 3 names.
- **One home per fact** (rule 3). Nothing below stores a count or a list that can be computed from a record that already holds it.
- **Tally suggests and enforces mechanical rules; it decides nothing.** A hint below is marked as a suggestion in its answer, and no new sentence in a brief states a rule of the tracked repository. A rule reaches a repository through its rulebook, at the operator's word.
- **A weakness is proved before it is fixed.** Several items of Part E come from an audit that read the code and ran nothing. Write the failing test first. If the test cannot be made to fail, the weakness is not real: leave the code alone and list the item under "not needed" in the final report, with what the test showed.
- **Before the operator pushes,** scan the tracked files and every new commit message for the private words the local notes list.

## 3. Decisions taken, which the operator may change

The operator said to write the plan on the planner's recommended answers. Each is cheap to change before its part is built and costly after.

| # | question | taken |
| --- | --- | --- |
| 1 | The word for a build session. "Session" already means an agent's session in every tool and on the Done page. | **`cycle`**: cycle 1, cycle 2, a Cycles page, `docs/records/cycles/cycle-<n>/`. An agent's session keeps its word. |
| 2 | What a closed cycle takes with it. | **Archived:** the ledger's finished milestones, closed tracks, evidence, reviews, hand-offs of closed tracks, the activity log, the build log, phases, manual checks (Part M), and notes that are done, tally's own, or addressed only to closed tracks. **Stays:** config, project, rules, conventions, areas, interfaces, how-tos, findings, every decision, every question, checks, plans, documents, reports, releases (Part N), open notes, and every id counter. |
| 3 | How the operator's word reaches tally. This replaces DESIGN section 12 row 8 and section 21.1 decision 3. | **An operator session records it over MCP with the operator's own words quoted** (`said`). A decision recorded so is marked unconfirmed until the operator confirms it on the board. The command line keeps `--operator`. Asking the operator through the client's own dialog is left out (section 11). |
| 4 | Targeted hand-outs. | **A work order:** a task cites record ids, and the brief carries those records word for word. A builder's and a reviewer's tool set, each at its own address. Tally answers a role's definition as text and writes no file into a repository. |
| 5 | A landing that checks its tip only. It gives up "every commit on main passed its checks alone" for that landing. | **Allowed per landing, said in its record,** with each commit checked as the default. A repository can turn it off. |
| 6 | A call that names no repository. | **An MCP address for each repository** (`/r/<name>/mcp`), where such a call reads that repository. The plain address is unchanged, because the first tracked repository's script relies on its default. |
| 7 | The host's command line is an old build, and writes the first tracked repository's records beside the service. | **Not built here.** Section 12 lists the steps, which are the operator's to order. |
| 8 | The order. | **0.7.0:** cycles, the verbs the ledger and tracks lacked, and a service that keeps house. **0.8.0:** the operator's word over MCP, decision links, work orders, role surfaces. **0.9.0:** landing options, a trial tree, manual checks, releases, hints. |
| 9 | The limit on `tools/list`. The plan adds 14 tools to 67. | **Kept at 77,000 characters for the whole list, at every release** (the operator's word, 2026-11-20). What is added is paid for as Part T says, and the test's number does not change. A builder's list holds at most 30,000 and a reviewer's at most 22,000, from 0.8.0. The operator removes tools at the next upgrade, from the ranking of Part U. |
| 10 | New words for a run's kind. Adding a value to a stored enum makes the file unreadable to an older build. | **Accepted at the tool and the runner, stored as kind `evidence` with a `label`.** The stored enum does not grow. |

**The one format change that is not an optional field or a new file:** closing a cycle moves files. An older build then reads the current folder as a repository with a fresh ledger, which is valid, and does not see the closed cycles. Nothing an older build writes is lost.

## 4. Release 0.7.0: cycles, the missing verbs, and a service that keeps house

### Part A. Cycles

#### A.1 What exists today

- Every record is found from one field, `repo.recordsDir` (`core/src/store/records.ts`). `openRepo` reads the config from the records folder and joins the opened tracks (`tracks.json`) and added phases (`phases.json`) into it.
- `phase_close` (`core/src/phases/close.ts`) is the pattern for an operator-only close: blockers first, tracks closed, a summary, a note to all, one records commit, and a pending mark so that an interrupted close is finished later (`records/pending-phase.ts`).
- The ledger has a `baseline` commit; `ledger_check` covers main from there.
- Ids that must never repeat are numbered from counters kept in their files: `reviews.json` (`nextId`), `context/notes.json` (`nextNumber`), each `context/<kind>.json` (`nextNumber`), `questions.json` (`nextRow`). A run record's id is random.
- `doneWork(repo, source)` and `collect(repo, ledger)` build Done and the board from a repository and a ledger.

#### A.2 The design in one paragraph

A repository's work runs in numbered cycles. The current cycle is what the records folder holds, as today. `cycle_close`, an operator session's call made on the operator's word, moves the finished work of the current cycle into `docs/records/cycles/cycle-<n>/`, in the same layout as the records folder, and leaves a fresh ledger whose baseline is main's tip. Context, rules, decisions and questions never move. A closed cycle is read on demand: nine read tools take `cycle`, and a Cycles page lists the closed cycles with their phases, milestones and tasks. When everything planned in the current cycle has landed, an operator session's brief and the board say so, in a sentence that tells the agent to ask the operator.

#### A.3 The records

- **`docs/records/cycles.json`**, new: `{schema: 1, current, cycles: [{n, name?, from, to, closedAt, closedBy: {track, agent}, said, decision?, summary}]}`.
  - A repository with no such file is in cycle 1 and has closed none. Nothing changes for it until `cycle_close` is called.
  - `from` is the archived ledger's baseline and `to` the tip of main at the close.
  - `said` holds the operator's words. Counts and lists are not stored: they are computed from the cycle's folder when asked (rule 3).
- **`docs/records/cycles/cycle-<n>/`**, new, in the layout of the records folder: `ledger.json`, `tracks.json`, `phases.json`, `reviews.json`, `buildlog.json`, `evidence/`, `handoffs/`, `log/`, `context/notes.json`, and from 0.9.0 `manual/`.

What the close does with each file:

| file | to the cycle's folder | stays in the records folder |
| --- | --- | --- |
| `ledger.json` | every milestone with a landed task, and `other` | a ledger with `baseline` = main's tip, `other` empty, and the carried milestones |
| `tracks.json` | every closed track's row | the rows of tracks still open |
| `phases.json` | every phase record, the open ones closed first (A.5) | the record of an open phase that holds a carried milestone |
| `reviews.json` | the reviews of archived milestones | the reviews of carried milestones, and `nextId` unchanged |
| `buildlog.json` | the entries of archived milestones, and a copy of the preambles | the preambles, and the entries of carried milestones |
| `evidence/<milestone>.json` | the files of archived milestones, moved whole | the files of carried milestones |
| `handoffs/<track>.json` | the files of closed tracks | the main branch's, a config track's and an open track's |
| `log/<date>.json` | every day file there is | nothing; the close's own event starts a new file |
| `context/notes.json` | notes that are done, that tally wrote, or that are addressed only to closed tracks | every other note, and `nextNumber` unchanged |

- **A carried milestone** is one with no landed task that is not marked built. It goes to the next cycle untouched, with its planned tasks, so work planned ahead is not lost.
- **Ids are not reused across cycles.** The counters stay where they are. `milestone_add` refuses an id that a closed cycle's ledger holds, and names the cycle. A phase id and a track name may be used again.

#### A.4 What stops a close

`cycle_close` changes nothing unless all of these hold. The refusal names the first, says how many more there are, and `cycle_list` names them all (`blockers`), in this order:

1. No landing is queued or has its turn.
2. Main holds no commit the ledger does not record (`owedCommits`, as `phase_close` asks).
3. Every milestone with a landed task is finished, by the one meaning of finished (DESIGN 20.2).
4. Every open track is either carried (it has a task, and every task of it sits in a carried milestone) or could be closed now by the rules of `track_close`. This is checked without closing anything.
5. No carried milestone sits in a closed phase.
6. At least one milestone is finished.

An open question stops nothing, and neither does a session on the main checkout.

#### A.5 The close

`cycle_close({sessionId, summary, said, name?, decision?})`, an operator session's alone. `summary` holds at most 500 characters and `said` from 1 to 500. A track's session is refused and told to ask with `question_add`.

In this order, under the landing lock:

1. The blockers of A.4 are checked.
2. The tracks that can be closed are closed, as `phase_close` closes them.
3. A plan of the close is written to `docs/records/cycles/cycle-<n>/closing.json`: each move, and each file to be written with its contents.
4. Each open phase whose milestones are all archived is closed with the summary "closed with cycle <n>".
5. The plan is carried out. A whole file is renamed into the cycle's folder. A split file's archived part is written into the cycle's folder first, and then its remaining part replaces the current file, each atomically.
6. The cycle's record is added to `cycles.json` and `current` becomes `n + 1`.
7. `closing.json` is removed, a note goes to all ("cycle <n> was closed by <agent>: <summary>"), and the records are committed as one commit, `records: cycle <n> closed`, in every records mode but `never`. A landing's turn makes the commit wait, as for a phase.

- **An interrupted close is finished, never undone.** While a `closing.json` exists, the next tool call on that repository, or the watcher's next pass, carries out what is left of it. Each step is safe to repeat: a move whose source is gone and whose target exists is done.
- **The answer:** `{cycle, archived: {milestones, tasks, tracks, files}, carried: {milestones, tracks, notes, parked, unbuilt, openQuestions}, tracksClosed, commit, next}`.
  - `parked` lists the parked parts of the archived ledger, each with the task it came from.
  - `unbuilt` lists the ids of decisions whose state is `decided, not built` or `partly built`.
  - Together they are what the coordinator plans the next cycle from.

#### A.6 Reading

- **`cycle_list({n?, limit?, sessionId?, repo?})`**, a read.
  - With no `n`, it answers `current` and `closed`.
  - `current` is `{n, since, milestones: {open, finished, carried}, tasks: {landed, total}, complete, blockers, ask?}`.
  - `closed` is newest first, each `{n, name, closedAt, closedBy, summary, from, to, milestones, tasks}`, 20 unless `limit` says, with `matched`. The two counts are read from that cycle's ledger.
  - With `n`, it answers that cycle's record whole, with its totals (phases, milestones, tasks, tracks, runs, reviews, notes, days of activity) and its `parked` parts, computed from its folder.
- **`cycle`** is a new optional parameter, a whole number of 1 or more, on nine reads: `board_get`, `evidence_list`, `review_list`, `handoff_read`, `track_list`, `phase_list`, `activity_get`, `note_list`, `deferred_list`.
  - With it, the tool reads the closed cycle and the answer names it (`cycle`).
  - A number that is no closed cycle is refused with the numbers that are. The current cycle's number is refused with "leave `cycle` out to read the current cycle".
- **A closed cycle's board** holds its milestones and tasks as they were at the close, with no claim, session, lock or queue.
- **One function** makes the view, `cycleView(repo, n)`: the repository with `recordsDir` at the cycle's folder and the base config joined with that folder's tracks and phases. No writing function is ever given a view; a test holds that.
- **Nothing else reads a closed cycle by default.** `context_pack`, the brief, `ledger_check`, Done and the board read the current cycle only.

#### A.7 The sentence that asks

`complete` is true when the current cycle has a finished milestone and A.4 would stop nothing. Then `ask` reads: "everything planned in cycle <n> has landed: ask the operator whether to close it; cycle_close takes their words in `said`".

- It is answered by `cycle_list`, by `board_get` (`cycle: {n, complete, ask}`) and in an operator session's brief (`brief.cycle`).
- A track session's brief carries only `cycle: {n}`.
- Tally closes no cycle by itself.

#### A.8 The page

- **Navigation:** Board, Done, Cycles, Evidence, Docs on a wide screen. On a phone the bottom bar must neither wrap nor scroll at 375 px: if seven entries do not fit, Cycles is reached from a line at the top of Done.
- **`GET /cycles`** answers what `cycle_list` answers.
- **`GET /cycles/<n>/done`** answers the Done work of a closed cycle, built by `doneWork` on that cycle's view.
- **The page** shows the current cycle first (its number, its counts, and the asking sentence when it is complete), then the closed cycles, newest first. Each has its number and name, when it closed and by whom, its summary, the operator's words, and its counts. A closed cycle unfolds into its phases, milestones and tasks, drawn by the components Done uses.
- It reads only while shown, and again on each snapshot. A failed read says so in a sentence, with "Try again".
- **Done** is unchanged and shows the current cycle. Its Sessions list keeps its name.

#### A.9 Tests that must fail first

- A repository with no `cycles.json` answers cycle 1, and every existing test passes untouched.
- Each blocker of A.4, one by one, with nothing changed after the refusal.
- A close with one finished milestone, one carried milestone and one open carried track: each file of the table in A.3 is where the table says, with the contents it says.
- Counters: after a close the next review, note and entry take the next number, not 1.
- `ledger_check` is clean after a close, and a commit made after it is owed.
- A close killed after each step of A.5 in turn is finished by the next call, and the result is identical to an uninterrupted close.
- Each of the nine reads with `cycle`; the two refusals; a view handed to a writing function is refused.
- `milestone_add` with an id from a closed cycle.
- A frozen copy of 0.6.1's ledger, tracks and reviews schemas reads the current folder after a close.
- The page: the list, an unfolded cycle, the empty state, the failed read, and the bar at 375 px.

### Part B. The verbs the ledger and the tracks lacked

- **`milestone_edit({sessionId, milestone, name?, waits?, drop?})`**, an operator session's.
  - `waits` takes a text or `null`, and `null` clears the line.
  - `drop` is `[{id, why, decision?}]`: each named deliverable gains `dropped: {why, decision?, by, at}` and is no longer a gap in `ledger_check`.
  - A deliverable that a landed task covers cannot be dropped. An unknown id is refused with the ids the milestone has.
- **`milestone_remove({sessionId, milestone, why, decision?})`**, an operator session's.
  - It removes a milestone that has no landed task, no claimed task and no queued landing, with its planned tasks, as `task_remove` removes one task. The tracks whose tasks waited on them are told, and the run records stay.
  - A milestone with a landed task is refused: it is the record of its commits.
- **`track_edit({sessionId, name, addPaths?, purpose?})`**, an operator session's or a session of the track's parent.
  - It only widens. The added paths join the track's, a child cannot go wider than its parent, and the row gains `widened: [{paths, by, at}]`.
  - A track with no `paths` is already unlimited, and the answer says so.
  - The answer carries the track's paths and `declared` (below).
- **`track_open` and `track_edit` answer `declared`:** the open tracks whose declared paths overlap this track's, each with the paths they share. It warns and refuses nothing. Until now an overlap was seen only once two tracks had changed the same file.
- **`track_close` takes `endSessions`.** With `endSessions: true`, tally first ends the sessions open on that track that hold no claimed task, as `session_close` ends them, and then closes the track. A session that holds a claim still refuses. Left out, the tool behaves as today, and its refusal for an open session names `endSessions`.

Tests first, for each verb: its refusals, what the record holds after it, and who may call it.

### Part C. Words for a run, and a review's own text

- **Words.** `evidence_record`, `evidence_run` and the runner accept, beside the nine stored kinds, the words `check`, `test`, `lint`, `typecheck`, `build`, `integration` and `e2e`.
  - A run given one of these is stored with kind `evidence` and `label` holding the word. It is judged by nothing: its exit is its result.
  - Another word is refused with both lists.
  - `evidence_list`'s `kind` takes the same words and matches the label.
- **Scope.** A run record gains `scope`, optional, at most 200 characters: what was run when it was not the whole (for example "the 31 tests of one module, coverage off"). The runner takes `--scope <text>`.
- **A review's text.** `review_record` takes `text`, at most 20,000 characters, in place of `report`.
  - Tally writes it to `<repository>/.temp/tally/reviews/<review id>.md` and records that path as the review's `report`.
  - Both given is refused. `summary` is still required.
  - The file is tally's own under `.temp/` and is never deleted (rule 10).

### Part D. Refusals that say what is accepted

- **An unknown argument** is refused with the tool's own parameters listed.
  - For `repo` given to a writing tool, the refusal adds "a writing tool takes sessionId; its repository is its session's".
  - For `cwd` given to `session_open`, it adds "session_open takes worktree: the folder you work in".
  - The message comes from the tool's own strict schema (`mcp/src/decorate.ts`), as the limits of section 22.7 do.
- **`limit`** holds at most 200 on `evidence_list`, `note_list`, `decision_list` and `question_list`.
- **`capabilities.tools.listChanged`** is false: the server keeps no connection it could tell.

### Part E. A service that keeps house from the start, and survives a bad file

1. **Watchers at the start.** The service starts a watcher for every listed repository when it starts, and for a repository when it is added. Today one is made only when its board or its API is first asked for (`server/src/hub.ts`, `serve.ts`), and MCP calls never make one. Test first: a service with a listed repository and a runner result waiting, with no HTTP call made, records the run.
2. **A failed write leaves nothing behind.** `writeJsonAtomic` removes its temporary file when the write or the rename fails, and flushes the file before the rename. The records commit never adds a `*.tmp` file. Test first: a write that fails leaves no temporary file, and a stray one is not committed.
3. **A git call has a time limit.** A git command that does not end within its limit fails its operation, which releases whatever lock it held. Choose the limits from the longest operations the suite and the driver show, and name them as constants. Test first: a stand-in git that sleeps.
4. **A lost lock ends one operation, not the service.** Test first, against the lock library as it is used in `core/src/store/lock.ts`.
5. **One unreadable file does not take a repository's reads down.** With a `tracks.json` or `phases.json` that does not parse, the repository opens with the config's own tracks and stages, read tools answer and name the file as the repository's problem, and writes that need that file are refused with the file named. Test first.
6. **A build keeps what it does not know.** Every record read from the records folder and written back keeps the keys its schema does not name, on the file and on each item. This covers the ledger, tracks, phases, decisions, questions, reviews, run records, hand-offs, context entries, notes, the build log, the activity log, cycles, and from their releases manual checks and releases.
   - The config is left as it is: `repo_configure` refuses a key the schema lacks, by design.
   - Test first, for each kind of file: an extra key on the file and on an item survives an update made through the tools.
   - `RULES.md` rule 8 gains the sentence, and says that builds before 0.7.0 still drop such keys.
7. **An address for each repository.** `/r/<name>/mcp` serves the same tools.
   - A read there that names no session and no repository reads `<name>`, and the answer is unchanged in shape.
   - `session_open` there refuses a folder of another repository and names that repository's address.
   - The server's instructions there name the repository.
   - `/mcp` is unchanged, byte for byte.

### Part T. Paying for the list

The whole of `tools/list` stays at most 77,000 characters at every release, and the test that holds it (`mcp/tests/meta.test.ts`) keeps its number. What this plan adds is paid for in this order:

1. **What a tool lists.** One function shapes each tool's entry in the list.
   - It leaves out `$schema`.
   - It leaves out any block that says only what the protocol takes as the default.
   - It lists a hint only where the hint differs from the protocol's default (a tool that only reads lists `readOnlyHint`; a tool that writes without destroying lists `destructiveHint: false`). Every tool still has its four hints in `TOOL_META`.
   - Test first: a client of the SDK reads the trimmed list and calls every tool; a read tool is still marked as one; each entry is a valid tool by the protocol's own schema.
   - DESIGN 19.10 is reworded to say so.
2. **The shared parameter texts** (`sessionId`, `repo`, `limit`, `fields`, `cycle`) are each said once, as short as they can be.
3. **A tool that can only refuse is not listed.** Where the service runs no command (`TALLY_COMMANDS=agent`), `land_run` is not registered. `evidence_run` stays, because it answers the runner line there.
4. **Descriptions.**
   - A new tool's description holds at most 300 characters: what it does, who may call it, and what it refuses. What a parameter means goes in the parameter's text.
   - The ten longest descriptions that exist are tightened, with no fact dropped that an agent needs to choose the tool or to call it right.

**The floor.** If a release still does not fit after all four, the builder neither raises the number nor cuts a description below what an agent needs. It stops before that release's last part, records `NEEDS THE PLANNER` with the sizes, and goes on to nothing else in that release.

### Part U. A count of what is called

So that the operator can see which tools earn their place, and remove tools by use at the next upgrade.

- **What is counted.** Every call that reaches a tool, for each tool:
  - `calls`; `refused`, the calls answered with an error; `cut`, the answers shortened by the size limit;
  - `first` and `last`, the times; `days`, the number of days with a call;
  - `by`, the calls by scope: `operator`, `track`, or `none` for a call with no session;
  - `via`, from 0.8.0, the calls by address: `whole`, `builder` or `reviewer`;
  - `repos`, the calls by repository.
- **A call the schema refuses** before the tool runs is counted as `invalid` wherever the server can see it: a tool that is often called wrongly is a tool whose description fails. If the SDK gives no place to see it, say so under `DEVIATION` and count the rest.
- **Nothing else is kept:** no argument, no answer, no session id.
- **Where.** It is not a record and not in git, because it is about tally's tools and not about a repository's work.
  - The service keeps one file for every repository: `<TALLY_HOME>/usage.json`.
  - A server of one repository keeps `usage.json` in that repository's state folder.
  - Counts are held in memory and written at most every 30 seconds, and when the server stops, atomically. A crash loses at most that.
- **Reading.** No MCP tool is added for it: the list is what is being kept small.
  - `GET /api/usage` and the command `tally usage` answer the ranking: the tools by calls, the most called first, each with its counts and `chars`, the characters its entry costs in `tools/list`.
  - Beside it, `never`: the listed tools with no call since counting began, and the characters they cost together.
  - And `since`, when counting began, with each version served since then.
  - The Overview page gains a table, "Tools by use", with the same.
  - A tool that is counted and no longer listed stays in the file, marked as not listed.
- **Tests first:** a read, a write, a refusal and a cut answer are each counted; the file is written, and read back after a restart; two repositories are counted apart; the ranking's order, `never` and `chars`; no argument reaches the file.

### 0.7.0, the surface

- **Tools:** 72 (71 listed where the service runs no command). New: `cycle_list`, `cycle_close`, `milestone_edit`, `milestone_remove`, `track_edit`.
- **Parameters added:** `cycle` on nine reads; `track_close.endSessions`; `review_record.text`; `scope` on `evidence_record`.
- **Stored:** `cycles.json` and the cycles folder; a deliverable's `dropped`; a track's `widened`; a run's `label` and `scope`. Outside git: `usage.json`.
- **The command line:** `tally usage`.
- **`tools/list`:** at most 77,000 characters, the number unchanged.

## 5. Release 0.8.0: the operator's word over MCP, decision links, work orders and role surfaces

### Part F. A decision or an answer, recorded with the operator's words

#### F.1 What exists today

- `addDecision` and `replaceDecision` (`core/src/records/decisions.ts`) take `authority: {operator}` and write `by: "operator"`. `setDecisionStatus` takes who recorded it. The command line passes the flag (`cli/src/commands/decision.ts`) and logs the write under the session `cli`.
- `POST /api/r/<name>/operator/decisions` and `.../questions/<row>/answer` exist (`server/src/operator.ts`), guarded by a header and a JSON body. No page calls either.
- MCP has `decision_list` and `question_add`, `question_list`, `question_edit`. In the second tracked repository, 13 of the first 15 rule entries were decisions written as rules, because a rule was the only operator-level record an MCP session could write.

#### F.2 The tools

- **`decision_record({sessionId, group, text, said, id?, section?, status?, state?, accept?, paths?, replaces?})`**, an operator session's alone.
  - `said` is required, from 1 to 2,000 characters: the operator's own words, quoted, that make this a decision. A decision the agent reached by itself is not one: the description says so, and says a track that wants a decision asks with `question_add`.
  - `id` defaults to the next `DEC-<n>` after the highest in the file. Where the group's ids do not follow that form, `id` is required.
  - An `id` that exists is refused unless `replaces: {why}` is given. Then the decision is replaced as the command line replaces one, and the old text is kept in `replaced`.
  - The record gains `said`, `via: {session, track, agent}` and, until confirmed, nothing more. `by` stays `operator`.
  - It is logged as `decision_add` or `decision_replace`, under its real session.
- **`decision_status({sessionId, id, group?, status, state?})`**, an operator session's: the status and state a decision already keeps, with the five states of section 21.3.
- **`question_answer({sessionId, id, decision, said?})`**, an operator session's: answers an open question with a decision's id, as the command line does.

#### F.3 Confirming

- A decision that has `via` and no `confirmed` is **unconfirmed**.
  - `decision_list` answers it with `unconfirmed: true`, and takes the filter `unconfirmed`.
  - An operator session's brief answers `decisions: {unconfirmed, disputed}`: a count, and the ids disputed.
- **The board** gains a list, "Decisions to confirm", shown only when there is one. Each row has the id, the text, the operator's words as recorded, and who recorded it and when, with two buttons.
  - **Confirm** sets `confirmed: {at}`.
  - **Not mine** sets `disputed: {at}`. A disputed decision is one of the repository's problems, on the board and in every operator brief, until it is replaced or its status says it is withdrawn.
  - The routes are `POST /api/r/<name>/operator/decisions/<group>/<id>/confirm` and `.../dispute`, guarded as the operator's routes are.
- A decision written from the command line or by the board's own route has no `via` and needs no confirming.
- **What this guarantees, plainly:** the record shows which session wrote a decision and what words it claimed, and the operator sees each one and can refuse it. It does not stop an agent from writing a false one; nothing on one machine without a login can (rule 11).

#### F.4 Tests that must fail first

Each refusal of the three tools; who may call them; the next id; a replacement keeps the old text; the unconfirmed and disputed states in `decision_list`, the brief and the board's problems; the two routes and their guard; a decision written by the command line is not unconfirmed.

### Part G. Links on a decision and on a task

- **A decision** gains two optional fields: `accept`, at most 12 lines of at most 300 characters, what must be true for it to count as built; and `paths`, globs from the repository's root. `decision_record` takes them, and `decision_list` answers them.
- **A task** gains `cites`, the ids of records it is built to (a decision, a context entry of any kind, a question, a note, a review), and `accept`, its own lines of what done looks like, within the same limits.
  - `task_plan` and `track_open`'s `plan` take both.
  - An id that names no record is refused by name, before anything is written.
- **A hint, not a write.** `ledger_check` and an operator session's brief answer `decisionsToMark`: each decision whose state is `decided, not built` or `partly built`, that at least one task cites, and whose citing tasks have all landed. The coordinator sets the status. Tally sets none.

### Part H. The work order

#### H.1 What exists today

`sessionBrief` (`core/src/context/brief.ts`) answers the project, every rule in force (id, section, title, text), the track's unlanded tasks with brief and paths, the current hand-off, the id, kind and title of the other entries whose paths overlap the track's, who else works, the count of open questions and what is missing. `work` drops the rules' text and most of the project; `land` keeps the tasks by id.

#### H.2 The level

`session_open` takes a fourth level, `brief: "order"`, a track session's. An operator session that asks for it is answered at `work`. It answers:

- `track`: the name, the hand-off, and each unlanded task with `milestone`, `id`, `brief`, `paths`, `accept`, `cites`, `waits`, `claimedBy`.
- `cited`: every record the track's unlanded tasks cite, once each, **word for word**:
  - a decision with `id`, `state`, `text`, `accept`;
  - an entry with `id`, `kind`, `title`, `text`;
  - a question with its words, its `meanwhile` and its answer;
  - a note or a review with its text or summary.
- `rules`: each rule in force with `id`, `section` and `title`, and with `text` only for the sections `authority` and `safety` and for a rule that is cited.
- `entries`: the id, kind and title of the entries whose paths overlap the track's and that are not cited.
- `working`: the sessions on tracks whose changed files overlap this track's, and `others`, a count of the rest.
- `rulebook`, `cycle: {n}` and the level's name.

The size cut spares `cited` and `rules` while any other part can be cut.

#### H.3 The two rules that go with it

Tally states no rule of its own. Two rules join the rulebook template (`rulebook-template.ts`), in the section `authority`, for a repository to adopt at the operator's word with `rulebook_adopt`:

- A record is the authority over any brief or prompt that restates it. Where they differ, the record is right, and the builder says so to the main track before building.
- A brief cites a record by its id and does not restate it.

A builder reports a difference with `note_post`, kind `request`, whose `about` gains the optional `record`: the id the brief differs from. The inbox of the main track shows it as it shows any request.

#### H.4 Tests that must fail first

An order carries a cited decision's text and `accept` exactly as stored, and the text of no decision that is not cited; a cited rule has its text and an uncited `working` rule has none; a safety rule always has its text; the cut spares `cited`; an operator session gets `work`; `about.record` reaches the main track's inbox.

### Part I. A builder's and a reviewer's surface

- **Addresses:** `/mcp/builder` and `/mcp/reviewer`, and under a repository, `/r/<name>/mcp/builder` and `/r/<name>/mcp/reviewer`. Each serves a subset of the same tools, built by the same code: a tool outside the role is not registered there.
- **The sets**, kept in one table beside `TOOL_META`:
  - **builder:** `session_open`, `session_close`, `task_claim`, `task_release`, `task_wait`, `task_unwait`, `evidence_record`, `evidence_list`, `land_start`, `land_wait`, `land_cancel`, `handoff_read`, `handoff_write`, `note_post`, `note_reply`, `note_done`, `inbox_get`, `question_add`, `question_list`, `decision_list`, `context_get`, `context_put`, `covering`, `board_get`.
  - **reviewer:** `session_open`, `session_close`, `review_record`, `review_list`, `evidence_list`, `decision_list`, `context_get`, `context_put`, `covering`, `rulebook_get`, `question_add`, `handoff_read`, `note_post`, `inbox_get`, `board_get`.
- **At a role's address** `session_open`'s `brief` defaults to `order`, and the server's instructions are the role's protocol in order, in at most 1,500 characters.
- **A role's definition, with no tool added for it.**
  - `repo_list` answers `roles`: for each role its `address`, its `tools`, and `allowedTools`, the names a client's allow-list takes.
  - `GET /api/roles/<role>` answers the same with `protocol` and `agentFile`: a sub-agent definition as text (a name, a description, the tool list and the protocol), for a session of the repository to save where its own tool reads such files.
  - Tally writes no file.
- **Tests first:** each address lists exactly its set; a tool outside the set cannot be called there; the builder's list is at most 30,000 characters and the reviewer's at most 22,000; `/mcp` lists everything.

### Part J. What covers these files

**`covering({paths?, range?, task?, limit?, sessionId?, repo?})`**, a read, for a reviewer handed a diff and a builder handed a file.

- `range` is `<base>..<head>`, two commits of the repository: the files are those the range changes. Each side is checked to be a commit before git is asked. `paths` names files or folders instead. One of the two is required.
- With `task`, as `MILESTONE:TASK`, the answer also holds that task's cited records.
- **The answer:**
  - `files`, at most 200, and `filesTotal`;
  - `decisions`, each with `id`, `state`, `text`, `accept`, whose `paths` match a file;
  - `entries`, each with `id`, `kind`, `title`, `text`, in force, whose paths match, the rules first;
  - `cited`;
  - `unplaced`, the count of decisions in force that carry no `paths` and so can never match, so that silence is not read as "nothing applies".
- **Tests first:** a range, paths, both refused together, neither refused, a side that is not a commit, the match rule shared with `context_get`, and `unplaced`.

### 0.8.0, the surface

- **Tools:** 76. New: `decision_record`, `decision_status`, `question_answer`, `covering`.
- **Parameters added:** `brief: "order"`; `cites` and `accept` on a planned task; `about.record` on `note_post`; `unconfirmed` on `decision_list`.
- **Answers that gain a field:** `repo_list` (`roles`).
- **Stored:** a decision's `said`, `via`, `confirmed`, `disputed`, `accept`, `paths`; a task's `cites` and `accept`; a note's `about.record`; two rules in the template.
- **`tools/list`:** the whole list at most 77,000 characters; the builder's at most 30,000; the reviewer's at most 22,000.

## 6. Release 0.9.0: landing options, a trial tree, manual checks, releases and hints

### Part K. Landings that cost less, and one that can be stopped

#### K.1 What exists today

`turnChecks` (`core/src/land/path-checks.ts`) chooses the checks once, from every file the landing's range changes, and the turn's script (`land-script.ts`) runs them for each commit, oldest first. With no `commands.checks` it runs `commands.test` for each. `cancelTicket` (`land/queue.ts`) refuses a ticket that is not `queued`.

#### K.2 Checks chosen for each commit

Where the config has `commands.checks`, each commit runs the checks whose paths match the files that commit itself changes, against its first parent. A commit that no check covers is refused when the turn is prepared, by name, with its files: the answer is a check that covers them, however small. With no `commands.checks`, nothing changes.

#### K.3 The tip only

- `land_start` takes `check`: `each`, the default, or `tip`. With `tip`, the script checks the last commit alone, with every check the landing's files choose.
- The ticket, the landing's answer, the landed task (`checked: "tip"`) and Done say so. `ledger_check` answers `tipOnly`, the count of landed tasks so checked.
- `commands.landing.tip` in the config is `allowed`, the default, or `never`, which refuses it.
- `RULES.md` rule 9 and DESIGN 14.1 are reworded: each commit is checked alone unless the landing was asked to check its tip only, which its record says.

#### K.4 A landing stopped at its turn

- `land_cancel` accepts a ticket at its turn. The ticket becomes `cancelled`, and the landing's own commit is undone as after a failure.
- The script stops: it runs no further commit, and it ends the check that is running, with a signal and then, ten seconds later, a harder one, sent to the check and to what it started in its own process group.
- What a check started elsewhere (a container, a server) is the check's to stop. `commands.landing.stop`, an optional command in the config, is run by the script after a cancelled or failed turn, for that.
- The script stays POSIX `sh`. Say in `GUIDE.md` what it cannot stop.

Tests first: each commit's own checks; the uncovered commit; a tip landing's record; `never`; a cancel at the turn with a check that sleeps, which must be gone within the limit; the `stop` command run once.

### Part L. A trial tree

For a runtime check of several lanes together, before any of them lands.

- **`trial_start({sessionId, name, tracks})`**, an operator session's.
  - Tally makes the branch `trial/<name>` at main's tip and a checkout under the repository's `.temp/tally/trials/<name>`, and picks each named track's commits ahead of main onto it, in the order given.
  - At the first conflict nothing is left behind, and the answer names the track, the commit and the files.
  - Otherwise it answers `{name, worktree, head, tracks: [{name, commits}], runner}`.
- **Runs there** are made with the runner, which there requires `--task`. Each is recorded against that task with `trial: {name, head}`, as the operator session's.
- **`trial_end({sessionId, name})`** removes the checkout and the branch, which are tally's own (rule 10). Run logs are kept, as always.
- A trial lands nothing: `land_start` from it is refused. `track_list` answers the open trials, and one left open for a day is one of the repository's problems.

Tests first: the picks in order, the conflict that leaves nothing, a run recorded with `trial`, the refusal to land, the end that removes both.

### Part M. A check made by hand

**`evidence_manual({sessionId, milestone, task, who, result, steps, device?, build?, note?, attachments?})`**, for what a person did on a device and no command can show.

- `result` is `pass` or `fail`. `steps` is from 1 to 30 lines. `who` says who did it, in words. The record keeps the session that wrote it.
- Each attachment is a file under the repository's `.temp/`, recorded with its path, hash and size, and never copied or moved (rule 6).
- **Stored** in `docs/records/manual/<milestone>.json`, a new file: `{schema: 1, milestone, checks: [{id, task, who, device?, build?, steps, result, note?, attachments, by, at}]}`.
- **Read:** `evidence_list` answers `manual`, the count for what was asked, and with `kind: "manual"` the checks themselves. The Evidence page lists them under their task.
- **A cycle's close** moves the folder with the rest.

Tests first: the record, an attachment outside `.temp/` refused, the count and the list, the move at a close.

### Part N. Releases

- **`release_mark({sessionId, version, commit?, notes?})`**, an operator session's. It records `{version, commit, at, by, notes?}` in `docs/records/releases.json`, a new file. `commit` is main's tip unless given and must be on main. A version is recorded once.
- **`release_list({version?, limit?, sessionId?, repo?})`**, a read. Each release answers with:
  - its tasks, computed and not stored: the landed tasks whose commit is on main at or before the release's commit and after the one before it, counted by milestone and listed by id;
  - `whatsNew`, where the config has `releases.notes`, a path with `{version}` in it: whether that file exists at the release's commit;
  - beside the list, `unreleased`: the landed tasks after the last release.
- **The Cycles page** shows a cycle's releases, those whose commit lies in its range.

Tests first: the tasks of two releases in a row, a commit not on main refused, `whatsNew` present and absent, `unreleased`.

### Part O. Hints

Each is marked `suggestion: true` where it orders or recommends, and none refuses anything.

- **The oldest question.** `board_get` and an operator session's brief answer `oldestQuestion: {id, days}` once an open question is older than `questions.nudgeDays`, 2 unless the config says.
- **Work built on a question's meanwhile.**
  - A task gains `under`, the ids of open questions whose `meanwhile` it was built on. `task_plan`, `land_start` and `task_land` take it.
  - `question_list` answers such tasks as `provisional`, and Done marks them.
  - When the question is answered, by any path, tally posts one note to the main track naming the tasks built under it, so they are checked against the answer.
- **An order for landings, with no tool added for it.** `track_list` takes `order`. With `order: true` it also answers, for each open track ahead of main, its changed files and the tracks it overlaps, and `landOrder`, a suggestion with a reason for each place: first what others wait on, then the tracks no other track overlaps, then the overlapping ones, the smallest first.

### 0.9.0, the surface

- **Tools:** 81. New: `trial_start`, `trial_end`, `evidence_manual`, `release_mark`, `release_list`.
- **Parameters added:** `land_start.check`; `under` on three tools; `track_list.order`.
- **Stored:** a task's `checked` and `under`; a run's `trial`; `manual/`; `releases.json`; `commands.landing.tip` and `stop`, `releases.notes` and `questions.nudgeDays` in the config.
- **`tools/list`:** the whole list at most 77,000 characters; the role lists as in 0.8.0, with `evidence_manual` added to the builder's.

## 7. In every release

- **Versions.** Every `package.json` and the lock file carry the release's version, and the handshake answers it. Each new tool has `since`.
- **The documents.**
  - `DESIGN.md` gains a section for each release (23, 24 and 25), in the form of sections 20 to 22: the decisions, each part as built, the surface, what was left out.
  - `GUIDE.md` gains what an agent must know to use each part.
  - `README.md` and `RULES.md` change where a rule or a count does.
- **The evaluation.** `evaluations/tally.xml` and its fixture gain questions for cycles, decisions and work orders, in the guide's format. It is not run with a model here (section 11).
- **The checks at the end of a release:** `npm run typecheck`; the whole suite; no source or test file over 400 lines; no comment in source; the limits on `tools/list`; a scan of the release's commits for the private words.
- **The image and the driver.** Build the image as `tally:candidate-<version without dots>` and nothing else: never tag `tally:local`. Run the private end-to-end driver against it with its own scratch folder, and extend it with steps for the release's parts. The local notes say where the driver is.
- **Commits.** One per part or smaller, each with the tests that prove it, in the form the log already uses. A release's version and documents are its last commits.

## 8. The order of work

1. 0.7.0: E.6 first (a build keeps what it does not know), because every later part adds fields. Then T.1 to T.3 and the tightening of T.4, because every later part adds to the list, and U, so that counting begins with the release. Then E.1 to E.5 and E.7, then B, C, D, then A.
2. 0.8.0: F, G, H, J, then I, whose sets name tools of the earlier parts.
3. 0.9.0: K, M, N, O, then L.

After each part, and after each release, the builder writes one line to the progress file the hand-over names: the part, its commits and the suite's count. A run that is paused is continued from there.

## 9. Against the MCP builder guide

- **Followed here:**
  - Tools stay focused: a verb each, with no tool that does two things by a switch.
  - Every new tool has a title, the four hints and a strict input.
  - Every new list is bounded by `limit` and answers `matched`.
  - Every refusal says what to do next.
  - Unknown arguments are now answered with what is accepted (Part D).
  - The role surfaces follow the guide's point that an agent should be handed focused tools (Part I).
- **Not followed, on purpose:**
  - Markdown answers: tally answers JSON to agents, by design.
  - A `tally_` prefix on tool names: the client already adds the server's name.
  - Cursor pagination: lists are small, newest first, and cut with a note that says how to narrow.
  - An output schema on every tool: it would add about as many characters again to the list. It is left out with the reason (section 11).
- **The SDK.** Tally is on `@modelcontextprotocol/sdk`, version 1. Version 2 (`@modelcontextprotocol/server`) is the current stable release, and version 1 receives fixes only. This plan stays on version 1: `mcpHandler` and `serveStdio` are the two functions a move would rewrite, and Part I changes the first of them. The move is its own change (section 11).

## 10. What the operator should know before the service is recreated

- No release here changes what the first tracked repository's commands print or accept. Its script that reads the default repository is untouched.
- A repository's records are not changed by an upgrade. A cycle is closed only by `cycle_close`, on the operator's word.
- Going back from 0.7.0 to 0.6.1 is free until a cycle is closed, a deliverable dropped or a track widened. After that the older build drops those fields when it next writes their file, and does not see closed cycles.
- A session that builds or reviews should be registered at the role's address from 0.8.0; the plain address keeps working.

## 11. Left out

- **Asking the operator through the client's own dialog** (MCP's question to the human) for a decision or a close. It needs an interactive client at hand to try, and some clients cancel it when no one is there.
- **Running the evaluation with a model.** It spends a model's tokens, so it is the operator's to order.
- **The move to version 2 of the SDK.**
- **Output schemas.**
- **Command-line verbs for the new tools.** The command line keeps what it has.
- **An Evidence page for a closed cycle.** A closed cycle's runs are read with `evidence_list` and `cycle`.
- **Moving a milestone to another phase**, parts E to G of the third review's plan, and parts H to J of the fourth's (a lane that starts from another lane, records committed by age, a lighter open board).
- **An allowance for a known flaky test.** A tip-only landing covers the case the reviews met.
- **A host-side runner that executes a landing for the service.** The command line's `tally land` already queues, runs and waits in one step when it talks to the service (section 12).
- **Removing tools, and one way to do each thing.** The operator does that at the next upgrade, from the ranking of Part U; nothing is removed here.
- **Pruning notes and the activity log** in a repository that never closes a cycle.

## 12. What only the operator orders

Not for the builder.

1. **Recreating the service** on each release's image, after the planner's check.
2. **Rebuilding the host's command line** (`npm run build` in the main checkout) and setting `TALLY_URL` where the first tracked repository's scripts call it. That ends two builds writing one repository's records, and gives every agent a landing in one command.
3. **Closing the second tracked repository's first cycle**, in a session of that repository.
4. **Setting `commands.checks`** in the second tracked repository, in a session of that repository: its one check for everything is why each of its commits ran every suite.
5. **Adopting the two new template rules**, in each repository, with `rulebook_adopt`.
6. **Pushing.**
