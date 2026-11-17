# Tally: what the fourth review found, and what to build from it

**Written:** 2026-11-17 09:19 IST (2026-11-17 03:49 UTC)
**Base:** `main` at `65d441b` (version 0.5.1, 1,613 tests, 67 MCP tools).
**Status:** not built. This is a plan for a coding agent; the planner checks the result against the repository afterwards. Parts A to G are to be built, as version 0.6.0. Parts H, I and J are not built; they are specified below so that the operator can choose them later.
**Follows:** `2026-11-16-1602-third-review-plan.md`, which is built as 0.5.1.
**This repository is public.** This file names no private project. Keep it that way when you edit it: the private names, paths and commit hashes are in the local notes, which git ignores.

## 1. Where this comes from

The fourth review was written on 2026-11-17 by the coordinating agent of the second tracked repository, after 16.5 hours of parallel work on 0.5.1: up to six sessions at once, two accounts, subagents, 16 tracks opened, 295 run records, 29 reviews. The planner checked every finding against the code and that repository's records, read only. The review's counts match the records within a few late events.

What held up, by the review: no record was lost or corrupted under parallel writes, no lock was needed, review chains and hand-offs carried work across agents that stopped and resumed, and nothing expired wrongly.

| Finding | What the check showed |
| --- | --- |
| **F1.** A lane's tasks planned from an operator session land on main, and every claim and runner result is then refused | True. `task_plan` takes the session's track when none is given, and an operator session's is main. A refused runner result is moved to `results/refused/<id>/` with its problem and nothing takes it back. Six lanes were blocked for about 1.5 hours, and each refused result was put back by hand. |
| **F2.** A failed run recorded as green stays green | True. `judgeRed` judges only red. Nine green records of the period exited 1. |
| **F3.** The command line on the host was an older build, so 0.5.1's logging of decisions never ran | True, and wider than written: 24 decisions were written or changed after 0.5.1 went live and none left an event. The build in that checkout was three days older than its source, and nothing said so: a build reads its version from `package.json` when it runs, so an old build reports the new version. |
| **F4.** A lane cannot start from another lane | True. `track_open` always branches from main. A feature: part H, not built. |
| **F5.** A call that names no repository silently answers for another | True. It reads the default repository, as the parameter says, and the answer does not name the repository it read. |
| **F6.** Evidence run on an uncommitted tree is filed under the commit before it | Not as written. A run record keeps no commit at all: the runner reads the head and nothing stores it. The hashes were in notes the agents wrote. The need is real: a reader cannot tell what a run ran on. |
| **F7.** The runner records a folder the command does not resolve from | True, and worse than written. The runner never changes folder, so the command runs where it was called, and the record always says the worktree's root. The record is wrong, not short of an option. |
| **F8.** In the `phase` mode, records wait uncommitted for hours | True: 18 record files were waiting when checked. That is the mode's design. A feature: part I, not built. |
| **F9.** `handoff_read` answers large | True. The largest answer was 21,478 characters, 14,363 of them earlier notes, already cut to 2 of 5 by the size limit. |
| **F10.** A size limit surfaces as a raw validation error | True. The limit is in the input schema; the refusal is the schema checker's own text. |
| **F11.** A review's report under the main checkout could not be recorded from a lane session | Not as written. An absolute path under the repository's `.temp/` is accepted from any session; a relative one is read against the session's worktree. The refusal does not say so. |
| **F12.** Many short operator sessions | True; information only. Nothing to build. |

## 2. Read this before building

- `RULES.md`, above all rule 12: tests first, no comments in TypeScript source, no file over 400 lines, immutable updates, errors as `TallyError`.
- `DESIGN.md` §21, the last build, and `GUIDE.md` §10, what agents are told.
- The code each part names. Check every claim in this plan against it, and say in your report where the plan was wrong.
- The size of `tools/list` is held under 77,000 characters by `packages/mcp/tests/meta.test.ts`. It is 76,991 on a host and 76,589 in the image today. Two parameters are added here, so other descriptions must be tightened to pay for them, without losing meaning.

## 3. Decisions the operator may want to change

1. **Nothing here refuses what works today.** Planning a task on main from an operator session stays allowed, and a call that names no repository still reads the default: the first tracked repository's scripts rely on both. Each gains a sentence that says what happened.
2. **A refused result is tried again by tally, with no new tool.** It is retried when the ledger has changed since it was refused. The review's other option, a tool that requeues it, adds a tool for a step nobody should have to take.
3. **A green that failed is filed as `other`,** as a red that did not fail already is. Records already written are not rewritten: a run record is written once (rule 6).
4. **A stale build warns and goes on.** It does not refuse: a script that calls the command line must not stop working because a build is old.
5. **A run records the head it ran on and whether the tree had uncommitted changes.** It does not record the tree's own hash: computing one writes objects into the repository for every run. Attributing a run to a later commit with the same tree is left out with it.
6. **`handoff_read` keeps its default.** The earlier notes are left out only when the caller asks, as `board_get` does with `rows`.
7. **The version is 0.6.0:** two tools gain a parameter, a run record gains two fields, and the command line gains a verb.

## 4. Part A: a lane's tasks reach the lane, and a refused result is not lost (F1)

**A1. `track_open` can plan the lane's tasks.** It takes `plan: { milestone, tasks }`, where `tasks` has `task_plan`'s shape. The tasks are planned on the new track in the same call, and the answer gains `planned`, the sentence `task_plan` would answer.
- What can be refused is checked before the track is made: the milestone exists and is open, and the tasks are well formed. Nothing is made when it is refused.
- If the plan still fails after the track is made, the track stays open and the answer says why in `planProblem`.
- Who may pass `plan` is who may call `task_plan` with that track.

**A2. `task_plan` says when it chose main.** When an operator session plans without `track`, and at least one track opened with `track_open` is open, the answer gains `notice`: the tasks are on the main branch's track, which tracks are open, and that `track` plans them on a lane. Nothing is refused.

**A3. A refused result is tried again when the ledger changes.** In `takeResults` (`packages/core/src/records/results.ts`):
- A result under `results/refused/` whose `problem` file is older than the ledger's last change is recorded again, by the same path as a fresh one.
- When it records, it moves to `results/taken/` as any other, without its `problem`.
- When it is refused again, `problem` is rewritten, so that it waits for the next change. The track is told again only when the sentence differs.
- At most 20 are retried in one pass of one worktree.
- The note that tells a track about a refused result says that it is kept and tried again when the ledger changes.

Tests first: `track_open` with a plan puts the tasks on the new track and a lane session claims one; a closed milestone refuses before any branch or worktree exists; the notice, and no notice when no track is open or `track` is given; a result refused because its task is on another track is recorded once the task is planned on its track, with no hand move; a result refused for a reason that still holds stays refused and posts no second note; the cap.

## 5. Part B: a green that failed is not filed as green (F2)

`judgeRed` (`packages/core/src/records/evidence.ts`) becomes the judge of both kinds. A run recorded as `green` that did not exit 0 is filed as `other`, with the notice "recorded as other, not green: it exited 1", told to the caller where a red's notice is told. It holds for `evidence_record`, the runner's results, `evidence_run` and `tally import evidence`.

Tests first: a green that exits 1 by each path; a green that exits 0 unchanged; the red rules unchanged; the notice.

## 6. Part C: a build knows when it is older than its source (F3)

- **A stamp.** `npm run build` ends by writing a small file into the command line's `dist`: the version it was built at, and when. The image is built with the same command, so it has one too. Mind that the image's build stage copies only `packages` and the package files.
- **A warning.** A command run from a `dist` whose stamp names another version than its `package.json`, or from a `dist` with no stamp, says so in one line on the error stream and goes on with the exit code it would have had: the version it was built at, the version of its source, and that `npm run build` rebuilds it. Run from source, as the tests do, it checks nothing.
- **`tally version`** prints the source's version, the build's version and time, and, with `TALLY_URL` set, the service's version. It says which differ, and exits 1 when the build is not the source's version.

Tests first: the stamp is written by the build's last step; a matching stamp is silent; another version warns once and keeps the exit code; no stamp warns; from source, nothing; `tally version` in each case.

## 7. Part D: an answer says which repository it read (F5)

A read that names neither a session nor a repository, while more than one repository is listed, answers with the repository's name: `repo` in the structured answer and one last line of text that says it read the default repository and that `repo` reads another. It is done once, where a read finds its repository (`packages/mcp/src/source.ts`), so every read tool has it. With one repository listed, or with a session or a `repo`, an answer is as before.

Tests first: the name is there by default with two repositories; not with one; not with `repo` or a session; a tool whose answer already has a `repo` key is not broken by it.

## 8. Part E: a run records what it ran on, and where (F6, F7)

- **Where.** The runner (`packages/core/src/land/runner.ts`) records the folder the command ran in, not the worktree's root.
- **On what.** A run record gains two optional fields: `head`, the commit the worktree was at, and `dirty`, whether it held uncommitted changes then. What tally itself keeps in the worktree does not count as a change. The runner already reads the head; now the record keeps it.
- **Both runners.** The same two fields are recorded where the server runs the command (`evidence_run`, `packages/core/src/records/run.ts`). A run recorded with `evidence_record` has neither.
- **Readers.** `evidence_list` answers them with the record. The Evidence page shows the head, shortened, and says "with uncommitted changes" when there were.
- **Stored format.** The fields are additive and the schema stays 1. Check what an older build does to them when it rewrites an evidence file, and say so in the design.

Tests first: a run from a folder below the worktree records that folder; a clean tree records its head and `dirty: false`; an edited or untracked file gives `dirty: true`; the runner's own files do not; an older record without the fields still reads; `evidence_list` and the page.

## 9. Part F: a refusal says the limit, or the path (F10, F11)

- **A text that is too long** is refused in tally's own words, for every text parameter that has a limit: the parameter, its limit and the length given. Find where an invalid argument is answered today and answer there. The listed input schema keeps each limit, and no description grows.
- **A file that is not found** from a relative path (`review_record`'s `report`, `evidence_record`'s `logPath`) is refused with the path it was read against, and with the sentence that an absolute path under the repository's `.temp/` is accepted.

Tests first: `review_record` with a summary of 1,001 characters; one other tool's limit; a relative report from a lane session; an absolute one under the repository's `.temp/` accepted from a lane session.

## 10. Part G: a hand-off without its history (F9)

`handoff_read` takes `history`: how many of the latest earlier notes to answer. Left out, the answer is as today. `history: 0` answers the current note alone, and `earlier` counts the notes left out. Its description says that a session wants `history: 0` unless it reads how the hand-off changed.

Tests first: 0, 1, more than there are, left out; `earlier`; a track with no hand-off.

## 11. Part H, not built: a lane that starts from another lane (F4)

`track_open` would take `base`, an open track: the branch starts at that track's head, `track_list` and the board show it, `land_start` refuses the lane until its base has landed and then rebases onto main, and its tasks wait on the base's. It costs nothing today, by the review: the stacked lanes are held until a release and will be landed in order by hand.

## 12. Part I, not built: records committed by age in the `phase` mode (F8)

`records.commitAfter: { files?, hours? }` in the config: in the `phase` mode the service would also commit the waiting records once they pass either bound, as an ordinary records commit, when no landing has its turn. It changes what the mode means, one commit for a whole phase, so it is the operator's choice.

## 13. Part J, not built: a lighter open board

Seen on the service after 0.5.1, not in the review: with `rows: "open"`, the second tracked repository's board is whole at about 23,300 of 25,000 characters, and about 9,900 of them are the tracks' lists of uncommitted files. With `rows: "open"`, each track could answer a count in place of the list. Until then, `fields: ["rows"]` is the smaller answer.

## 14. The surface, checked

- **MCP tools:** 67 before and after.
- **Parameters added:** `track_open.plan`, `handoff_read.history`.
- **Answers that gain a field:** `track_open` (`planned`, `planProblem`), `task_plan` (`notice`), a default read (`repo`), `handoff_read` (`earlier`), `evidence_list` rows (`head`, `dirty`).
- **Stored formats:** a run record gains `head` and `dirty`, both optional.
- **The command line:** `tally version`, and one warning line on the error stream from a stale build.
- **Record the size of `tools/list`** on a host and in the image afterwards.

## 15. Order, and what done looks like

Build in this order, one part per commit or small run of commits, each with its tests first:

1. **Part B**, the smallest.
2. **Part D.**
3. **Part C.**
4. **Part A.**
5. **Part E.**
6. **Parts F and G.**
7. The version, the guide, the design, the rules and the README.

Done means:

- `npm run typecheck` and `npm test` pass; no source or test file is over 400 lines; no comment in changed source.
- The six `package.json` files carry 0.6.0, and the test of the server's version agrees.
- `GUIDE.md` says how a lane's tasks are planned with `track_open`, what happens to a refused result, what a green that failed becomes, what a run record says it ran on, and how to read a hand-off without its history. `DESIGN.md` gains §22 with the decisions of §3 and the parts left out; the private copy gains the same. `RULES.md` changes only if a rule's words no longer hold.
- `npm run build` succeeds, and the image builds under a tag of its own, not the tag the service runs. The running container is left alone.
- The builder's report says what was built, what differs from this plan and why, and what was not verified.

## 16. Rolling out

1. The operator recreates the service. Before that, check that no session, claim or landing is in flight in any listed repository. No client has to reconnect: no tool is added.
2. **The command line on the host** is rebuilt once, at the operator's word, because the first tracked repository's scripts run it. Until then it is the build of 2026-11-13: it logs no decision and has no stamp to warn with. Afterwards a build that falls behind its source says so.
3. **A lane's runner** is rewritten when its next session opens, so open lanes get parts B and E without being reopened.
4. **The second tracked repository** changes nothing. Its coordinator can pass `plan` to `track_open`, and read hand-offs with `history: 0`.
5. **The first tracked repository** needs no change.

## 17. What this plan leaves out

- Parts H, I and J, for the operator to choose.
- A tree hash on a run record, and attributing a run to a later commit with the same tree (decision 5).
- Rewriting the eleven green records that failed before this build (decision 3).
- An option on the runner to choose the folder: it records the folder it was called from, which is what a replay needs.
- Recovering the events of the decisions written by the older build.
- Fewer operator sessions for bookkeeping (F12): the review asks for nothing.
- Refusing a call that names no repository, and guessing the repository from the caller's last session: the service keeps no caller between calls.
