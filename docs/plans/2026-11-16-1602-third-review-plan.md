# Tally: what the third review found, and what to build from it

**Written:** 2026-11-16 16:02 IST (2026-11-16 10:32 UTC)
**Base:** `main` at `679557f` (version 0.4.2, 1,567 tests, 67 MCP tools).
**Status:** built on 2026-11-16 as version 0.5.1, in the ten commits from `73b7feb` to `f83ebed` (1,613 tests, 67 MCP tools), and running in the service since that day. The operator chose what to build: parts A, B, C and D. Parts E, F and G are not built; they stay specified below in case they are wanted later. The text below is the plan as it was written before the build. Where the build differs:
- **The version is 0.5.1, not 0.5.0** (decision 6). The planner's check found one flaw, and the version counts the fix, as it did for 0.4.2.
- **A session's tasks (part C).** §6 says a target is cut at its first comma. That cut short every task name that has a comma, and showed two tasks that differ only after the comma as one. Now only an `evidence_record` target is shortened, by the kind that ends it, and every other target is taken whole. The operator had the planner make this fix; a second reviewer read it.
- **The size of `tools/list`** is 76,589 characters in the service's image (76,411 before). Three descriptions were tightened to keep it under the 77,000 a test holds.
- **How much room the open board has (part D).** In the second tracked repository, `rows: "open"` answers its 7 open milestones whole, in about 23,300 of the 25,000 characters an answer may have: about 12,500 for the rows and about 9,900 for the tracks, whose lists of uncommitted files grow with the work in progress. With `fields: ["rows"]` as well, the answer is about 12,500.
- **The dashboard's operator routes** that answer a question or add a decision write no activity event. Part B covers the command line only, and the plan did not mention them.
**Follows:** `2026-11-16-1239-done-view-plan.md`, which is built, and `2026-11-14-2324-assessment-and-direction-notes.md`, whose §9 questions the review answers (§14 below).
**This repository is public.** This file names no private project. Keep it that way when you edit it: the private names, paths and commit hashes are in the local notes, which git ignores.

## 1. Where this comes from

The coordinating agent of the second tracked repository wrote a third review on 2026-11-16, after two days of use since 0.3.0 and a first look at 0.4.2. In those two days that repository landed two fix lanes, one after the other, with five recorded reviews. Its maintainer cut three releases with their own script. The coordinator made six commits directly on main and recorded five decisions.

The review confirms that 0.4.2 does what it was built for there: the board shows the 7 open milestones, Done shows 1 closed phase, 10 finished milestones, 63 landed tasks and 107 ended sessions, and the phone layout fits.

It then lists eight findings. Each was checked against the code and that repository's records (read only) before planning:

| finding | what the check showed |
| --- | --- |
| **F1.** Log events written after the records commit dirty the checkout, and the commits that sweep them up count as unrecorded | True. Three commits made by the maintainer's release script each hold one 7-line `session_close` event and nothing else, and each had to be recorded by hand. `flushWhenFree` commits nothing in the `phase` records mode unless a phase close is pending, so every session leaves its own close event uncommitted. A fourth such file waits now. |
| **F2.** Every release cut and every direct commit on main needs a `task_other` by hand | True. Twelve were recorded in two days: the 3 above, 3 release cuts (one file each, each with a tag) and 6 direct commits. Of 10 sessions, 4 did nothing else. |
| **F3.** A milestone cannot move to another phase, so a catch-all phase can never close | True. No tool or command changes a milestone's phase. `milestone_add` calls it `stage`, the phase tools say `phase`, and the page says "Stage". |
| **F4.** Decision changes are made on the command line behind a declared `--operator`, do not show in the activity log, and get their state from free text | Partly true. A decision does keep `state`, `by` and `on`. But `by` is always the word "operator", only the last change is kept, the log holds no event for a decision or an answer, and `stateOf` reads the state from the status's first words: new decisions were filed as `other` until their status was reworded, and two of that repository's records commits hold them so. |
| **F5.** Agents pay for finished rows on every `board_get` | True, and worse than the review says. The answer is cut at 25,000 characters, so in that repository an agent that asks for the board gets 10 of 17 milestones, and only 5 of the 7 open ones. The answer does say it was cut. |
| **F6.** Done's sessions show no tasks for the session that ran both lanes | True. Its 14 writes were track, review and evidence calls, and only `task_claim`, `task_land` and `land_start` count as naming a task. |
| **F7.** The board gives two finished counts that the reader must add up | True: "10 finished" above, "9 finished milestones are in Done" and "1 closed phase is in Done" below. |
| **F8.** 0.4.2 has no tag | Done since: an annotated `v0.4.2` was made locally on 2026-11-16. Pushing it is the operator's. |

## 2. Read this before building

- `RULES.md`: rule 1 (the records are written by the harness alone), rule 2 (progress is counted from the ledger and git), rule 7 (records commits) and rule 12.
- The check: `packages/core/src/ledger/check.ts` (`unrecorded`) and `ledger/audit.ts` (`checkLedger`, `changedFiles`). `unrecorded` has four callers: `ledger/audit.ts`, `status/collect.ts`, `state/inbox-ledger.ts` and `packages/cli/src/commands/ledger.ts`.
- Records modes: `records/commit.ts` (`recordsMode`, `flushWhenFree`, `flushClosedPhase`) and `packages/mcp/src/decorators/activity.ts`.
- Decisions and questions: `records/decisions.ts` (`stateOf`, `addDecision`, `replaceDecision`, `setDecisionStatus`), `packages/cli/src/commands/decision.ts` and `commands/question.ts`.
- Done's sessions: `packages/core/src/done/sessions.ts`.
- The page: `packages/web/src/open.ts`, `components/Board.tsx`, `components/DoneSessions.tsx`, `components/Done.tsx`.
- For the parts the operator may choose: `packages/mcp/src/tools/ledger.ts` (`board_get`, `milestone_add`), `decorators/sized.ts` (the 25,000-character cut), `schema/config.ts`, `ledger/ops.ts` and `phases/open.ts`.

## 3. Decisions the operator may want to change

1. **A commit that changes only files under the records folder is passed over by the check, whoever made it.** The review recommends the narrower rule, only files under the log folder. The wider one is chosen because in the `phase` mode every record waits on disk between commits, so the same release script can sweep up the ledger or a decision as easily as the log. It does not weaken a protection: the check has only ever looked at a commit's subject, which anyone can write.
2. **What the check passes over, it shows.** `ledger_check` names those commits, so a script that commits records is visible and never silent.
3. **Decisions stay on the command line, and `--operator` stays a declared flag.** No MCP tool is added for them. An operator session is declared in the same way, so a tool would add attribution and no authority; the log gives the attribution without a tool.
4. **A write made from the command line appears in the activity log under the session `cli`.** Done's sessions leave it out, because it is not a session.
5. **Three features and one wording change were the operator's choice, and they chose part D alone.** §7 to §10 specify each so that the others can be built later:

   | part | what it buys | what it costs |
   | --- | --- | --- |
   | D. An open-only board for agents (F5) | the board an agent reads falls from about 54,000 characters to 13,000 in the second tracked repository, and stops losing open milestones to the cut | one option on `board_get` |
   | E. Commits the config tells the check to pass (F2) | a release cut needs no session and no `task_other` | one config key; it loosens "someone accounted for every commit", in the open |
   | F. Moving a milestone to another phase (F3) | a catch-all phase can be split and closed | a 68th tool |
   | G. "Phase" where the page says "Stage" | one word in the tools and on the page | the first tracked repository's own plans say "stage" |

6. **The version is 0.5.0,** the operator's choice: the build adds a field to `ledger_check`, options to the command line and an option to `board_get`.

## 4. Part A: a commit of records only is passed over (F1)

One function in core answers which commits on main the ledger still owes, and all four callers of `unrecorded` use it:

```ts
interface PassedCommit {
  commit: string;
  subject: string;
  why: string;
}

interface Owed {
  missing: string[];
  passed: PassedCommit[];
}
```

The rules:

- `unrecorded` stays the first step: a commit a record names, or whose subject starts with the records prefix, is not a candidate.
- A candidate is **passed** when it changes at least one file and every file it changes is under `records.dir`. Its `why` is `records only`. The files are those changed against its first parent, so a merge is judged by what it brought to main.
- Git is asked about candidates only, never about every commit: on a clean ledger the check costs what it costs today.
- `missing` keeps its form, so every caller that prints or counts it reads as before.

`ledger_check` gains `passed: { total, shown }`, where `shown` holds the newest ten with their commit, subject and `why`. When `total` is above zero, its text gains one line that says how many commits were passed over and why. The status's problems, the inbox notice, `phase_close`'s blockers and `tally ledger check` all stop naming a passed commit.

`RULES.md` rule 7 says that the check passes over records commits by their prefix. It gains: and over any commit that changes nothing outside the records folder, which `ledger_check` lists.

Tests first: a commit with another subject that changes only a log file; one that changes only the ledger; one that changes a record and a source file (still missing); a commit that changes no file (still missing); a merge; the four callers; a clean ledger makes no git call for files.

## 5. Part B: a decision or an answer written on the command line is on record (F4)

**The state is said, not guessed.** `decision add`, `decision replace` and `decision setStatus` take `--state`, one of the five states the record already has. Without it the state is read from the status as today. When that reading gives `other`, the command's answer says so and names `--state`. A value that is not one of the five is refused, with the five listed.

**The write is logged.** Where the repository keeps an activity log, these commands leave one event each, after they succeed:

| command | verb | target |
| --- | --- | --- |
| `decision add` | `decision_add` | `<group> / <id>: <state>` |
| `decision replace` | `decision_replace` | `<group> / <id>: <state>` |
| `decision setStatus` | `decision_status` | `<group> / <id>: <state>` |
| `question add` | `question_add` | the question's id |
| `question answer` | `question_answer` | the question's id |
| `question edit` | `question_edit` | the question's id |

- The event's session is `cli`, its track is the main branch, and its agent is the `--by` value when one is given and `cli` otherwise. `decision add` and `decision replace` gain `--by` for this; the record's own `by` stays the operator, whose decision it is.
- The event is written in the command-line layer, not in core, because the MCP tools for questions are already logged by their decorator.
- After the event, the waiting records are committed when no session is open, as the decorator does, so that the event does not wait alone in the modes that commit at once.
- A failed write of the event does not undo the decision: the command says the event was not written and why, and exits with success.
- `endedSessions` leaves out the session `cli`.
- `activity_get`'s description says that a verb is a tool or a command-line write.

This holds whether the command runs on the files or is carried out by the service.

Tests first: each of the six commands leaves its event; none where no log is kept; `--state` stored as given; the answer that names `--state`; the refusal; a failed event; Done's sessions without `cli`.

## 6. Part C: three small corrections to the Done build (F6, F7)

- **A session's tasks** also come from its `review_record` and `evidence_record` events. A target is cut at its first comma, so `<milestone> / <task>, <kind>` and `<milestone> / <task>` are one task.
- **The closed-phase line on the board** says how many milestones it holds: "1 closed phase, with 1 finished milestone, is in Done". The two lines under the board then add up to the count above it.
- **"Show 50 more"** says the number it will load: "Show 7 more" when 7 remain.

Tests first, one for each.

## 7. Part D: an open-only board for agents (F5)

`board_get` takes `rows`: `all` (the default, as today) or `open`. With `open`, `rows` holds only the milestones that are not finished, and the answer gains `finishedRows`, the number left out. It works with either scope and with `fields`.

Its description says that a whole board may be cut to fit, and that `rows: "open"` is what a session needs unless it asks about finished work.

Tests first: only unfinished rows; `finishedRows`; with `scope: "mine"`; the default unchanged; the second tracked repository's shape (17 rows, 7 open) answers whole.

## 8. Part E, not chosen: commits the config tells the check to pass (F2)

The config gains `ledger.passes`, at most 20 entries of:

```ts
{ subject: string; paths?: string[]; note: string }
```

- `subject` is a regular expression of at most 200 characters, matched against the commit's subject. One that does not compile is refused when the config is set.
- `paths`, when given, are folders or files relative to the repository. The commit must change at least one file, and every file it changes must be under them.
- `note` says in 1 to 120 characters what such a commit is.

A candidate commit that fits an entry is passed, with the entry's `note` as its `why`. It appears in `ledger_check`'s `passed` like a commit of records only. Nothing is written to the ledger for it. Only an operator session sets it, with `repo_configure`.

An entry with `paths` is the safe form. For a release cut it reads: a subject that starts `chore(release): v`, and `paths` holding the one version file. An agent cannot hide code under that subject, because code is outside those paths.

`RULES.md` rule 2 gains a sentence: a commit the config's `ledger.passes` describes is passed over, and `ledger_check` lists it.

Tests first: a matching subject with no `paths`; with `paths`, inside and outside; an expression that does not compile; the limits; a track session refused; `passed` naming the note.

## 9. Part F, not chosen: moving a milestone to another phase (F3)

A tool, `milestone_move`, for an operator session:

```ts
milestone_move({ sessionId, milestone, phase })
// answers { milestone, from, to, shares: { [phase]: { before, after } }, overall: { before, after }, commit }
```

- The milestone goes to the other phase with its tasks, their commits, its deliverables and its deferred parts. Its id does not change, so every link to it holds.
- Refused, each with what to do instead: a milestone or a phase that does not exist (the known ones named, at most ten); the phase it is already in; a milestone in a closed phase; a closed target.
- `shares` and `overall` say how the percentages changed, because a move changes them.
- It is logged like any other write, and committed under the repository's records mode.

It has no command-line form.

Tests first: the move keeps everything; each refusal; the shares before and after; a track session refused; after moving every unfinished milestone out, the phase can close.

## 10. Part G, not chosen: "Phase" on the page

The page says "Phase" where it says "Stage": the board's headings, Done's headings, the hero's lines and the top bar's range. `milestone_add`'s `stage` parameter gains a description that says it is the phase's id. The stored field, the terminal status and the Markdown view keep the word they have.

## 11. The surface, checked

- **MCP tools:** 67 before and after. (Part F, if it is ever built, makes 68: `milestone_move` would get `since` in `TOOL_META`, so that `server.newest` names it.)
- **Descriptions that change:** `ledger_check` (`passed`), `activity_get` (command-line writes) and `board_get` (`rows`). Record the size of `tools/list` afterwards; it was 76,411 characters.
- **Stored formats:** nothing changes. A decision's `state` is a field it already has.
- **The command line:** three decision verbs gain `--state`, and two gain `--by`. Nothing is removed.

## 12. Order, and what done looks like

Build in this order, one part per commit or small run of commits, each with its tests first and its own review:

1. **Part A.**
2. **Part B.**
3. **Part C.**
4. **Part D.**
5. The version, the guide, the design, the rules and the README.

Done means:

- `npm run typecheck` and `npm test` pass; no source or test file is over 400 lines; no comment in changed source.
- The six `package.json` files carry the new version, and the test of the server's version agrees.
- `GUIDE.md` says what `ledger_check` passes over and shows, how a decision's state is given, and how an agent asks for the open board. `DESIGN.md` gains a section for this build with the decisions in §3, and says which parts were left and why; the private copy gains the same. `RULES.md` rule 7 is reworded.
- `npm run build` and `docker build -t tally:local .` succeed. The running container is left alone.
- The builder's report says what was built, what differs from this plan and why, and what was not verified.

## 13. Rolling out

1. The operator recreates the service. Before that, check that no session, claim or landing is in flight in any listed repository. No client has to reconnect: no tool is added.
2. **The command line.** Part B reaches a repository only through a command line that has it. The build in this checkout's `dist` is older than the service and is rebuilt only at the operator's word, because the first tracked repository's scripts run it. A repository on the service can instead set `TALLY_URL` to the service's address when it calls `tally decision` or `tally question`: the service then carries the command out, with the new code, and there is one writer.
3. **The second tracked repository** needs to change nothing for Part A: the next commit its release script makes of a waiting record is passed over and shown. Its release cuts and its direct commits are still recorded by hand, and its catch-all phase still cannot be split: those were parts E and F. Its agents ask for `rows: "open"` to read the board whole.
4. **The first tracked repository** needs no change.

## 14. What the review adds to the direction decision

The review answers the ten questions of the assessment notes' §9 for its two days. In short, so that it can be set beside later reviews:

| question | this review |
| --- | --- |
| lanes and commits | one lane at a time; two lanes, 4 track commits, plus 3 release cuts and 6 direct commits on main |
| tools never called | `land_run`, `land_cancel`, the two lock tools, `checks_set`, `note_done`, `deferred_set`, `question_edit`, `views_claude` |
| tools called wrongly | none seen |
| worked around tally | decisions through the command line; a phase split replaced by status text; cross-account reviews run by scripts outside tally and then recorded |
| cost before work | tools loaded on demand by the client; the brief always at the `land` level; sizes not measured |
| a landing's time | 3 to 5 minutes from joining the queue to done, with no wait |
| refusals | none in the period |
| records in the wrong place | decision states filed as `other` because of wording |
| one lane | the landing gate, the review records and the ledger still earned their keep: two reviews each found a serious defect. The cost was bookkeeping: 12 hand-recorded commits and 7 bookkeeping sessions for 2 lanes |
| what to remove | candidates from non-use: `land_run`, the locks, the code-check tools, `note_done`, `views_claude` |

Where it agrees and disagrees with the assessment:

- **It agrees** that tally is heavy (§5.3): 28 write tools appear in that repository's log and about ten never do. It agrees that the command-line tail is real (§5.5), and that there is still one user (§5.1).
- **It disagrees with one judgment.** The notes said that below about three lanes tally is more ceremony than help. With one lane the gate and the reviews paid for themselves. The ceremony that did not pay was the bookkeeping. Part A cuts a quarter of it; part E, not chosen, would cut another quarter.
- **Four things 0.3.0 added have no real use yet** in the repository whose review asked for them: parked parts, required reviews, question ids with edits, and the `work` and `full` brief levels. That belongs beside "every review has added tools".
- **The removal candidates cannot be decided from this review alone.** The first tracked repository's scripts use the code-check record, the standing block and the command-line landing, and it keeps no activity log to count from.

## 15. What this plan leaves out

- **MCP tools for decisions**, and a history of a decision's earlier states beyond the activity log (decision 3).
- **A filter in Done for sessions with tasks.**
- **Not leaving the close event uncommitted in the `phase` mode.** Every record waits in that mode, by design; Part A makes the wait harmless.
- **Hiding the records from `git status`,** left out of the 0.3.0 plan for the same reason as then.
- **Removing tools** (§14).
- **A tag as a condition** for a passed commit. A subject with `paths` says the same with less.
