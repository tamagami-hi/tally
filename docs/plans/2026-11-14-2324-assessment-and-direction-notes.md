# Tally after 0.3.0: an honest assessment, and what to decide next

**Written:** 2026-11-14 23:24 IST (2026-11-14 17:54 UTC)
**At:** `main` at `f4a3eb1`, tagged `v0.3.0`.
**Status:** notes for a decision that has not been taken. Nothing here is a plan to build.
**Written by:** the agent that planned the last two builds and checked each one against the repository.
**This repository is public.** This file names no private project. Keep it that way when you edit it.

## 1. Why this file exists

After 0.3.0 was released, the operator asked for an honest view of the project, "however brutal it may sound", a rating of its usability, and whether projects like it exist. They then asked for the answer to be kept here. Their plan, in their words: "when i will start working and using this with my personal builds i will take on their review and as well as share your opinions with other agents as well, then we can decide where do we want to take this further."

So this file is one input to that decision. The others are still to come: reviews from the operator's own builds, and other agents' views of what is written here. §9 lists what to ask those reviews, so they can be set beside each other, and §8 lists the questions the decision has to answer.

## 2. What this is based on, and what it is not

Based on:

- two written reviews from a coordinating agent that ran real phases on tally, with five to twenty parallel lanes;
- the records those phases left in the second tracked repository, read to check the reviews;
- planning two builds from the code and checking each one afterwards: the whole test suite, the type check, an end-to-end run against the built image, and a read of the riskiest changes.

Not based on:

- a read of every line. The 0.3.0 build added 3,990 lines in 124 files, and only the riskiest parts were read.
- any use of tally by someone other than the operator and their agents. There is none yet.
- a read of the other projects in §7. Their descriptions and star counts were looked up on 2026-11-14; their code was not read.

The ratings in §6 are judgments, not measurements.

## 3. The numbers on 2026-11-14

| | |
| --- | --- |
| age | 11 days (first commit 2026-11-03) |
| commits on `main` | 217 |
| tracked files | 449 |
| TypeScript source, tests left out | about 12,000 lines |
| tests | 1,473 |
| MCP tools | 67 |
| the tool list an agent's client loads | 76,222 characters, roughly 19,000 tokens |
| a full session brief in the second tracked repository | about 12,000 characters |
| repositories using it | 2, both the operator's |
| stars, forks, issues on GitHub | 0, 0, 0 |

## 4. What is good

- **It solves a real problem, and there is evidence.** The second review reported a five-lane phase with no lost work and no collisions, one merge conflict that the overlap warning predicted, and a hand-off that let a different agent on a different account finish a job that a usage limit had cut off.
- **The core ideas are right.** Progress is counted from git and from nothing else. One landing happens at a time, with its checks run in a clean checkout. Records are plain JSON in the repository, so they can be read, diffed and audited without tally.
- **The discipline is real.** Tests come first, files stay small, inputs are strict, and a refusal says what to do next. Stored formats have only been added to.
- **The loop is fast.** A review became a plan, a build and a checked release within a day, twice.

## 5. What is not

Each point says what the evidence is and what would show it is fixed.

### 5.1 It has one user

Every feature came from one coordinator's reviews of the operator's two repositories. The 0.3.0 build changed one of the harness's own rules and added a record type shaped by one project's way of reviewing. That may be exactly right, or it may fit one workflow too closely; with one user there is no way to tell.

*Fixed when:* a second, unrelated project has run a phase on it and its review has been read beside the first two.

### 5.2 Nobody has read all the code

About 12,000 lines were written by agents in 11 days, from plans an agent wrote, and checked by an agent. The tests were written by the same agents that wrote the code. The one direct measure of whether an agent can use the tools, the evaluation in `evaluations/`, has only ever been answered by hand: it has never been run with a model.

*Fixed when:* the evaluation has been run with a model and its score is recorded; and a person, or an agent with no part in the build, has read the landing code and the records code end to end.

### 5.3 It is heavy

- 67 tools. The list alone is roughly 19,000 tokens in an agent's context before it does any work, unless its client loads tools on demand. The brief adds up to 12,000 characters.
- Every review has added tools. None has removed one.
- There are about twenty kinds of thing to learn: milestones, tasks, tracks, phases, sessions, claims, locks, tickets, run records, reviews, deferred parts, questions, decisions, six kinds of context entry, rules, hand-offs, notes, the build log, the checks record, plans and documents.
- Things overlap. A run can be recorded three ways (`evidence_run`, the runner, `evidence_record`). A track can land two ways (`land_run`, `land_start`). Records are committed in one of four modes. Commands run in one of two places.
- The primary user was confused by it. In the second tracked repository, 13 of the first 15 rule entries were really decisions, and tasks were filed under the wrong milestone and had to be marked as duplicates.
- Below about three parallel lanes it is more ceremony than help. That is a judgment: neither review measured it.

*Fixed when:* the tool list is about half its size, each thing has one way to do it, and a cold agent's first session shows no wrong-tool calls.

Candidates to look at first, as questions and not decisions: `land_run` beside `land_start`; `evidence_run` beside the runner; the build log, which the second review did not use; the four records modes; the tools no review has ever mentioned.

### 5.4 A stranger cannot adopt it

The README opens with a build diary, not a quickstart. It is not on npm and has no published image. Starting it needs Docker, an environment file and a mounted git config. `DESIGN.md` reads as a journal of what was approved when. The end-to-end test is private, so nobody outside can fully verify the public repository.

*Fixed when:* someone who has never seen it has a repository tracked and one landing done within fifteen minutes, from the README alone.

### 5.5 It carries a legacy tail

The first tracked repository's own scripts still call the host build's command line directly and name no service address, so they write its records beside the service. That is two writers on the same records, and each upgrade makes the gap between them matter more. Of the five tools added in 0.3.0, only the question edit has a command-line form.

*Fixed when:* every caller goes through the service, and the direct mode is either removed or stated as supported with its limits.

### 5.6 The ground is moving

Agent tools are adding worktrees, parallel sessions, background agents and task lists of their own. Part of what tally gives is being absorbed. What they are unlikely to absorb soon: a landing gate that refuses, an audit trail of runs and reviews, a rulebook shared by every agent, and coordination across accounts and vendors.

*Fixed when:* the project says in one paragraph what it is for that the agent tools are not, and drops what they now do better.

### 5.7 It depends on trust in one machine

The service has no login and relies on being reachable from the local machine only. It runs with the whole workspace mounted and writable. That is sound for one person on one machine and is not a base for a team.

*Fixed when:* either the README says plainly that this is its limit, or it gains a login.

## 6. Usability, as judged on 2026-11-14

| for whom | rating | what would move it |
| --- | --- | --- |
| The operator and a coordinating agent on a multi-lane build | 7 of 10 | fewer tools, one way to do each thing |
| An agent dropped in cold | 6 of 10 | a smaller tool list, a brief that fits the job, the evaluation run and acted on |
| A stranger arriving from GitHub | 3 of 10 | a quickstart, a published image, a public end-to-end test |

## 7. Projects in the same space

Looked up on 2026-11-14. Stars are as GitHub showed them that day. None of their code was read, so what each "is" comes from its own description.

| project | stars | what it says it is |
| --- | --- | --- |
| `gastownhall/beads` | 28,700 | a memory upgrade for a coding agent: task records kept in git |
| `gastownhall/gastown` | 18,800 | a multi-agent workspace manager |
| `BloopAI/vibe-kanban` | 28,700 | a board for running coding agents in parallel |
| `eyaltoledano/claude-task-master` | 28,400 | a task-management system for coding agents |
| `smtg-ai/claude-squad` | 8,800 | manages many terminal agents |
| `MrLesk/Backlog.md` | 7,400 | collaboration between people and agents, kept in git |
| `dagger/container-use` | 4,100 | separate development environments for coding agents |
| `agent-tower/core` | 400 | a command centre for coding agents |
| `mylukin/agent-foreman` | 250 | stops agents from half-building features |
| `wardmos/waybill` | 85 | portable hand-offs between coding agents |

Beads together with Gas Town is the closest in spirit. What was not seen combined elsewhere is tally's strictness: a landing queue that refuses, with run records and reviews kept as evidence. That cannot be called unique until theirs have been read.

## 8. What the decision has to answer

1. **Is this a personal tool or a public one?** As a personal tool it is fine as it stands, and §5.4 and §5.7 stop mattering. As a public one, they come first.
2. **If public, why this and not Beads with Gas Town?** Read both before investing more. The answer is either a clear difference worth keeping, or a reason to build on theirs.
3. **What is cut?** Name the tools and modes to remove before any are added.
4. **What does a cold agent need, measured?** Run the evaluation with a model, and let its failures decide what the tool list and the brief look like.
5. **When does the first tracked repository move fully onto the service?**
6. **What is the one paragraph that says what this is for?** (§5.6)

Until these are answered, the advice is to stop adding features.

## 9. What to ask the next reviews

So that reviews from different builds and different agents can be set beside each other, ask each one the same things:

- How many lanes ran at once, and over how many commits?
- Which tools did you never call? Which did you call wrongly before finding the right one?
- Where did you work around tally instead of using it, and why?
- What did a session cost before any work began: the tool list, the brief?
- How long did a landing wait, and how long did its checks take?
- Which refusal was unclear, and which one saved you from a mistake?
- Did any record end up in the wrong place? Which kinds of record did you confuse?
- Would you have used it for this build with one lane? With two?
- What would you remove?
- Do you agree with §5 and §6 of this file? Where is it wrong?

## 10. Decided, and waiting

- **The name.** On 2026-11-14 the operator chose `agent-yardmaster` for the GitHub repository, shown as "Agent Yardmaster" in the dashboard's title, and put the change off to the following week. Only those two things change: the command, the tools, the packages and the folders keep the name `tally`. Nothing has been renamed yet.
