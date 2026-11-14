# Tally: a rulebook template, work under `.temp/`, one records commit per phase, and idle worktrees removed

**Written:** 2026-11-14 03:12 IST (2026-11-13 21:42 UTC)
**Base:** `main` at `cd9ce5d` (1,105 tests, 55 MCP tools).
**Status:** built on 2026-11-14, in the eleven commits from `d017abd` to `67680ef` (1,301 tests, 62 MCP tools). The text below is the plan as it was written before the build; where the build differs, the commit bodies say how and why.
**Checked:** against the MCP builder skill on 2026-11-14; §8 is what that check added.
**This repository is public.** This file names no private project. Keep it that way when you edit it: the private names and paths are in the local notes, which git ignores.

## 1. What the operator asked for

On 2026-11-14 the operator passed on a coordinating agent's review of tally (about 20 parallel lanes over six phases in the second tracked repository), and asked for four things. Their words:

1. **Rules.** "i liked [the first tracked repository's] RULES.md file and how it was guiding the entire build but the rules there were specifically tailored for that repo, and i would like to generalise the rules which tally can bring them upon with a template of the rules and as per the project evolves or is made the tailoring will fall into place by the person and the agent."
2. **Work under `.temp/`.** "i did liked the idea to make .temp folder per repo to do the parallel build instead of using any other directories."
3. **Records committed once per phase.** "not commiting on every record and commiting the record once after the phase ends such that the git commits stays clean."
4. **Idle worktrees removed.** "remove the worktree (local only) and its artifacts such after the work has been done getting implemented and merged with main and is sitting idle."

Parts A to D below take them in that order. Section 8 holds every tool the plan adds or changes, checked against the MCP builder skill. Section 11 lists what the review asked for that this plan leaves out.

## 2. Read this before building

- **The standing rules** are in the local notes: `CLAUDE.local.md` and the file it includes. Neither is in git. The ones that bite here:
  - Commit with the repository's one identity, which the local notes give, and with no attribution line. Never push.
  - Never start `tally serve` and never recreate the Docker service. Ask the operator each time.
  - Never edit another repository's files from this checkout.
  - A design change goes in `DESIGN.md`, with generic names, and in the private copy of the design that the local notes name.
- **The house rules** are `RULES.md` rule 12: the test first, seen failing on its assertion; no comments in TypeScript source; source and test files under 400 lines; immutable updates; errors as `TallyError`.
- **How a change is built here:** cut a worktree from `main` under `.temp/worktrees/<name>`, run `npm ci` in it, build with tests first, get an independent review (`ecc:code-reviewer` or `ecc:typescript-reviewer`), fast-forward `main`, then remove the worktree and its branch. The suite is `npm test`; the types are `npm run typecheck`. Under load a test can time out at 5 s: rerun it alone before believing it.
- **Stored formats stay readable by the previous release** (`RULES.md` rule 8). Every schema change below is an optional field or a new file.
- **Before the operator pushes,** scan the tracked files and every new commit message for the private words the local notes list: the tracked projects' names and folder names, the operator's home path, and any track or lock name from a tracked repository's config.

## 3. Decisions the operator may want to change

The builder builds the recommended answer unless the operator says otherwise. Each is cheap to change before the build and costly after.

| # | question | recommended |
| --- | --- | --- |
| 1 | Is the template written into a repository when it is added, or brought by a tool? | **Brought by one call** (`rulebook_adopt`) in the first operator session. Both repositories tracked so far already had rules of their own when they were added, and 29 rules in force unasked would have contradicted them. |
| 2 | Is the template's text right? | **§4.7 as drafted**, from the rulebook the operator liked, with its project's specifics taken out. It is the operator's taste: edit it before the build. |
| 3 | When a worktree is removed, what becomes of the notes its agent kept under `.temp/`? | **Keep them:** move them to `<repo>/.temp/closed/<track>/`. Build output (everything else git ignores) is deleted. The harness promises to remove a worktree only "once nothing in them can be lost". |
| 4 | What is a phase? | **Tally's stage.** The tools say `phase`; the stored word stays `stage`. |
| 5 | Do new repositories start with records committed at phase close? | **Yes.** A repository already tracked keeps its setting until its own operator session changes it. |
| 6 | How long may a landed worktree sit idle? | **60 minutes**, set per repository with `worktrees.idleMinutes`. |
| 7 | The review's outline has a dated level above phases (`Sessions-<date>-<n>`: a build that is marked complete, with later work starting a new one). | **Not in this plan.** Say if it should be Part E. |

## 4. Part A: the rulebook template

### 4.1 What exists today

- A rule is a context entry of kind `rule` in `docs/records/context/rule.json` (`packages/core/src/context/entries.ts`). Only an operator session writes one. It has a title (120 characters at most), a text (2,000), paths, tags and refs. It is never edited: a successor `replaces` it.
- A rule has no section, no source and no order beyond its number. Any text is accepted.
- `session_open` answers every rule whole, with every field, in `brief.rules` (`context/brief.ts`). `context_pack` at the project level lists them flat (`context/records-pack.ts`).
- A repository added in the sidebar starts with no rule, and its brief says `missing: ["no rule"]`.
- What went wrong in the second repository: 13 of its 15 rule entries were decisions and answers, because a rule was the only operator-level record an MCP session could write. They were retired by hand.

### 4.2 The design in one paragraph

Tally ships one rulebook template: 29 short rules in four sections. An operator session brings it into a repository with one call. From then on each rule is an ordinary rule entry in force. Nine of them carry a question (`tailor`) that only the project can answer, and the operator session's brief lists those until each is settled. A rule is settled by writing its successor with the operator's word as its source (`rule_tailor`), or by retiring it. Every rule, from the template or not, now has a section and a source.

### 4.3 The record

Four optional fields on an entry (`entrySchema`), all additive:

| field | holds | set on |
| --- | --- | --- |
| `section` | `authority`, `safety`, `working` or `once` | every rule written from now on |
| `source` | whose word the rule is and when, or a decision's id; 200 characters at most | every rule written from now on |
| `template` | the key of the template rule it came from, such as `tests-first` | a rule adopted from the template, and every successor of one |
| `tailor` | the question the project still has to answer; 300 characters at most | a rule adopted from the template that has one, until it is replaced |

The sections, in order, each with the line a pack prints under its heading:

| section | heading | line |
| --- | --- | --- |
| `authority` | Authority | What wins when two sources disagree. |
| `safety` | Safety | Breaking any of these fails the work, whatever the tests say. |
| `working` | Working | How the work is done. |
| `once` | Doing each thing once | How to reach correct work without doing anything twice. |

A rule written before this change has none of these fields. It reads as it is, sorts after the four sections, and is fixed by `rule_tailor` when someone next touches it.

### 4.4 Writing

**`context_put` with `kind: "rule"`** (`putEntry`):
- `section` and `source` are required. The refusals name what to give:
  - `a rule needs its section: authority (what wins when sources disagree), safety (what fails the work), working (how the work is done) or once (doing each thing once)`
  - `a rule needs its source: whose word it is and when, such as "the operator, 2026-11-14", or the id of the decision it rests on`
- When it `replaces` a rule, `section` defaults to the old rule's, and `template` is carried over. `tailor` is not carried.
- For any other kind, `section` and `source` are refused: `only a rule has a section and a source`.

**`rulebook_adopt({ sessionId })`**, new (`adoptRulebook` in a new `context/rulebook.ts`):
- Operator session only. Refused in a repository whose config does not say `context: "records"`, because its rules are its `RULES.md`.
- Under the entries lock, it adds each template rule whose key no entry carries, in force or retired, in the template's order. So a rule that was tailored or retired is never brought back, and a second call adds nothing.
- Each added entry has `by` the session, `source: "tally's rulebook template"`, its `section`, its `template` key, and its `tailor` question when the template has one.
- It answers `{ added: [{ id, section, title }], waiting: [{ id, title, tailor }], already, commit }`, never whole entries: 29 of them would be about 16,000 characters. `rulebook_get` reads the words. With nothing to add it writes nothing and answers `added: []`.
- A later release of tally may add a rule to the template. The same call then brings only the new one. A changed wording of a rule a repository already has is never pushed onto it.

**`rule_tailor({ sessionId, id, source, title?, text?, section?, paths?, tags?, refs? })`**, new (`tailorRule`):
- Operator session only. `id` is a rule in force.
- It writes the rule's successor and retires the old one (`replaced by rule-N`), the way `replaces` does.
- `title`, `text`, `section`, `paths`, `tags` and `refs` default to the old rule's. So giving only `source` keeps the rule as written and settles it.
- `section` is required when the old rule has none.
- The successor keeps the `template` key and has no `tailor`.
- It answers `{ entry, retired, waiting, commit }`, where `waiting` counts the rules in force that still carry `tailor`.
- When one template rule becomes several project rules, the session tailors it into the first and adds the others with `context_put`.

**`context_retire`** is unchanged. It is how a template rule that does not apply is ended, with the reason.

Keep `entries.ts` under 400 lines: the rule-only checks and the two new functions go in `context/rulebook.ts`, and what `putEntry` and `tailorRule` share is extracted once.

### 4.5 Reading

- **Order.** Rules are always answered in rulebook order: by section in the order above, then by number; a rule with no section last. One function, `inRulebookOrder`, used by the brief and the pack.
- **The brief** (`session_open`):
  - `brief.rules` becomes `{ id, section?, title, text }` for each rule in force. The other fields are dropped there, which is what keeps 29 rules near 11,000 characters. `context_get` still answers whole entries.
  - An operator session's brief gains `tailoring: [{ id, title, tailor }]`, the rules that still wait, when there are any. A track session never gets it, since it cannot write a rule.
  - `missing` is unchanged. A repository with no rule still says `no rule`.
- **The pack** (`context_pack`, project level): `## Rules` holds one `###` heading per section with its line, then each rule as `#### rule-N. Title` and its text. Rules with no section come last under `### Other rules`. With no rule at all it prints: `(no rule yet: an operator session brings tally's rulebook with rulebook_adopt, or adds a rule with context_put)`.
- **The size limit.** `packages/mcp/src/decorators/sized.ts` cuts an answer's largest list first and keeps its end, so a large brief would lose its first rules, which are the authority and safety rules. Add `whole?: readonly string[]` to `ToolMeta`, set `session_open` to `whole: ["brief.rules"]`, and have `largestPart` pass over any part at or under such a path while another part can still be cut.
- **`rulebook_get({ section?, waiting?, fields?, sessionId?, repo? })`**, new, for any session: the rules in force, whole, in rulebook order. It is what a session calls to read the rules again, after a compaction for one.
  - `section` keeps one section. `waiting: true` keeps only the rules that still carry a question. `fields` keeps only those keys of each rule.
  - It answers `{ rules, waiting, template: { adopted, notAdopted } }`: `waiting` counts the rules that still wait, and `notAdopted` lists the keys of the template's rules this repository has never had, which is what `rulebook_adopt` would add.
  - `context_get` stays as it is, the newest entry first, for every kind.
- **Tool descriptions.**
  - `rulebook_get`: "The repository's rules in force, in rulebook order: authority, safety, working, then doing each thing once. Breaking a `safety` rule fails the work whatever the tests say. `waiting: true` keeps only the rules that still carry `tailor`, a question this project has to answer. `template.notAdopted` names the rules of tally's template this repository has never had."
  - `session_open`: say that `brief.rules` are in rulebook order, that breaking a `safety` rule fails the work whatever the tests say, and what `tailoring` is.
  - `rulebook_adopt`: "Bring tally's rulebook template into this repository (operator session only, and only on the operator's word: every rule it adds is in force for every session at once). It adds each rule of the template this repository has never had, and answers them. A rule adopted before is not added again, tailored or retired. A rule that carries `tailor` waits for this project's own answer: go through those with the operator and settle each with rule_tailor or context_retire."
  - `rule_tailor`: "Write a rule's successor (operator session only): the rule as this project needs it. `source` says whose word it is and when. What is left out stays as the old rule had it, so `source` alone keeps the rule as written and settles it. The old rule is retired and stays readable by its id."

### 4.6 Files and tests

| file | change |
| --- | --- |
| `packages/core/src/context/entries.ts` | the four fields; the rule checks in `putEntry` |
| `packages/core/src/context/rulebook-template.ts` (new) | `RULEBOOK`, `RULE_SECTIONS`, the section headings and lines, `RULEBOOK_SOURCE` |
| `packages/core/src/context/rulebook.ts` (new) | `adoptRulebook`, `tailorRule`, `inRulebookOrder`, `waitingRules` |
| `packages/core/src/context/brief.ts`, `records-pack.ts` | §4.5 |
| `packages/core/src/index.ts` | the exports |
| `packages/mcp/src/tools/rulebook.ts` (new) and `tools/context.ts` | the three tools; `section` and `source` on `context_put` |
| `packages/mcp/src/meta.ts`, `params.ts`, `decorators/sized.ts` | titles and effects (`rulebook_adopt` is an add that may be repeated; `rule_tailor` is an add), every parameter described, `whole` |
| `evaluations/fixture.py`, `evaluations/tally.xml` | the fixture's one rule gains a section and a source; the rest is §8.6 |

Tests to write first (`packages/core/tests/context/rulebook.test.ts`, `rulebook-template.test.ts`, and additions to `entries`, `brief`, `records-pack`, `packages/mcp/tests/context.test.ts`, `brief.test.ts`, and the `sized` test):
- The template: keys are unique and kebab-case; every title fits 120 characters and every text 600; every section is known; the slim brief form of all of it is under 13,000 characters.
- `adoptRulebook`: adds all 29 in order with their fields; a second call adds nothing and writes nothing; a tailored or retired template rule is not brought back; a track session is refused; a repository without `context: "records"` is refused.
- `putEntry`: a rule with no section or no source is refused with those words; a finding with a section is refused; a successor inherits the section and the template key and drops `tailor`.
- `tailorRule`: `source` alone keeps the words and clears `tailor`; given fields replace; a rule with no section needs one; a retired or unknown rule is refused; `waiting` counts down.
- `rulebook_get`: answers the rules in rulebook order; `section`, `waiting` and `fields` each narrow it; `notAdopted` lists all 29 keys before an adoption and none after; it works with no session.
- `rulebook_adopt` answers ids, sections and titles, and no rule's text.
- The brief: rules are slim and in rulebook order; `tailoring` is there for an operator session and absent for a track session.
- The pack: one heading per section, the safety line, older rules last.
- `sized`: an over-large `session_open` answer cuts another list before `brief.rules`.
- Every existing test that writes a rule gains a section and a source. That is a change of behaviour, not a weakened test.

### 4.7 The template, in full

Each rule is `key`: **title.** Text. Where a rule has a question, it follows as *Asks*. The text below is what goes in `RULEBOOK`, word for word.

**authority**

1. `authority-order`: **When two sources disagree, the higher one wins.** Highest first: these rules; the decisions; the code as last verified, with the checks record and the build log; the commit bodies, which say why; the open questions and what each says to do meanwhile; the plans, which say what is intended, not built. A plan that differs from the code is corrected, unless the code breaks a rule or a decision; then the code is fixed. *Asks:* Is there a source outside this repository (a specification, another system's documents) that wins over this repository's summary of it? Name it and where it is.

**safety**

2. `ship-only-when-asked`: **Never push, release or deploy unasked.** Pushing, publishing, releasing and deploying are the operator's to do or to ask for. An agent builds and verifies on this machine, and never runs a command with raised privileges. *Asks:* How is this project released and deployed, and who runs it? Name the commands an agent never runs.
3. `secrets`: **Credentials belong to the operator.** Never print a secret's value, never commit one, and never create, change or remove a credential or a .env file. Code reads a secret from its environment and, when it is missing, names it and stops.
4. `never-do`: **Change nothing outside this repository that cannot be undone.** Until the operator names what this project must never do, these are forbidden: spending money, sending a message to a person, and any request that changes another system. *Asks:* What must this project never do, whatever the tests say (place an order, charge a card, send mail, write to a system it does not own)? Each is a rule of its own.
5. `not-ours`: **What this project does not own is read-only.** Data, services, containers and files that belong to something else on this machine are never written, moved, restarted, pruned or deleted. Every command is scoped to this project's own names, never to everything on the machine. *Asks:* What shares this project's machine or feeds it data? Name what is read-only, and the names (project, containers, folders) that mark what is this project's own.
6. `invariants`: **A result that breaks an invariant is wrong, whatever the tests say.** Until the operator names this project's invariants, a change that alters what a result means is the operator's to decide, never the builder's. *Asks:* What must always hold in this project's results (no look-ahead, no money created or lost, nothing sent twice)? Each is a rule of its own, with the test that enforces it.
7. `unknown`: **Unknown stays unknown.** A value that is missing, unreadable or inconsistent is reported as missing and refused. It is never filled in, guessed or repaired silently, and every value shown traces back to where it came from.
8. `no-invented-values`: **Do not invent a value a result depends on.** A price, a rate, a limit or a size that is not configured or verified gets no default. Show it as unconfigured and refuse the run that needs it, naming it. A number that must exist and is not verified is labelled unverified wherever it is printed. *Asks:* Which values must never be defaulted here?
9. `stored-formats`: **Stored formats stay readable by the previous release.** A rollback swaps the code and keeps the data. So a schema, a file format or a stored record changes additively: add a field in one release, and drop one only in a later release. *Asks:* What does this project store for good, and which formats does this rule cover?
10. `operators-choices`: **Open decisions and gates are the operator's, and only those.** A choice is the operator's when it changes what a result means or costs, what is stored for good, what the project may do, or an existing decision. It becomes a question that states the conservative behaviour to build meanwhile, and is never decided in code. Every other choice is the builder's: make it, record it in one line, and go on. Report a gate's evidence; never declare it closed.

**working**

11. `tests-first`: **Write the test first and see it fail on its assertion.** A failure to compile proves nothing. A test added for code that already exists is proven once, by breaking that code by hand and seeing the assertion fail. A fixture written from the code's own belief proves nothing. Never weaken a failing test: decide which side is wrong and say so in the commit. *Asks:* Where do the tests live, what coverage must hold, and which areas are tested whatever the coverage says?
12. `no-comments`: **No comments in source.** Name things so the code reads on its own, and put the why in the commit body. A script that guards a dangerous step is the exception: its gates carry their reasons.
13. `simple`: **Keep it simple.** No hardening against a threat that does not apply. No abstraction, switch or option until something concrete needs it.
14. `small-files`: **Source and test files stay under 400 lines, 800 at most.** A change that takes a file past 400 lines splits it in the same change. Lockfiles, generated files, fixtures, data and reports are exempt.
15. `no-silenced-warnings`: **No silenced warnings, and nothing without a reader.** The linter and the type checker run with warnings as errors, and the source silences none. A new field or option gets its reader in the same change; when the reader comes later, so does the field.
16. `one-commit-per-task`: **One commit per task, and main stays linear.** Each commit builds and passes the tests on its own. Sessions working at the same time each commit to their own track's branch in its own worktree, rebase it on main after every task and land it by fast-forward through tally. Main never holds a merge commit, and a track's branch is never pushed.
17. `commit-body`: **The commit body is the log.** The subject is type(scope): an imperative summary, under about 70 characters. The body says why, the tradeoffs, the earlier belief it corrects and the numbers it relies on, and never restates the diff. One identity, the repository's, and no line that names an agent or a tool.
18. `instance-or-class`: **When you fix a bug, ask whether it is an instance or a class.** Search the code around it for the same shape, fix what you find, and say in the commit what you searched.
19. `collect-questions`: **Collect questions; do not stop to ask them.** Add a question only for a choice that is the operator's. Take the conservative reading (the one that refuses, holds or reports unknown, never one that invents a value), write it as the question's meanwhile, build it, and keep going. Stop only for what only the operator can do: a credential, a push, a deploy, raised privileges.
20. `real-numbers`: **Report real numbers, measured once.** A count, a timing or a size is measured, not remembered, by whoever claims it, and written down with its command. A speed claim also names the machine and the data. Anyone else measures it again only when it looks wrong or a decision rests on it, never when its code has not changed.
21. `code-over-docs`: **Trust the code over the docs.** Check a document's claim against the source before building on it. When they differ, settle it by the order of authority and correct the one that lost, once.
22. `records-describe-the-code`: **The records describe the code by the end of each milestone.** A milestone is not done until the ledger, the checks record, the build log and the context entries its changes touch say what was built. Never leave a record that describes behaviour the code no longer has.
23. `scratch`: **Scratch stays under .temp/.** Everything an agent writes that is not part of the repository (plans, notes, logs, throwaway scripts and builds) goes under .temp/ in the checkout it works in, one folder per track. Nothing there is ever cited: what a record relies on is recorded through tally.

**once**

24. `decide-once`: **Decide once.** A choice recorded as a decision, in the build log, or settled by the order of authority is not reopened on opinion by a later step or agent. Evidence reopens it: a failing test or a measurement that shows a builder's choice wrong corrects it, and that is recorded; one that shows a decision wrong becomes a question.
25. `record-once`: **Record once.** Each fact has one home: a decision in the decisions, an open question in the questions, what was built and measured in the build log, the code as last verified in the checks record, progress in the ledger, and why in the commit body. Everything else points to that home and never copies it.
26. `read-once`: **Read once.** Read what the brief and the task name, not every document. Hand a helper these rules and the paths and ids it needs, never "read everything".
27. `check-once`: **Check once.** Before running a check, compare the code fingerprint with the checks record: while they match, the record is the verification, and nothing runs again. While working, run the checks of the part you changed, and the tests before each commit. The whole sweep runs once, before the milestone's last commit and before review. *Asks:* What is this project's whole sweep, command by command?
28. `review-once`: **Review once, against the plan.** A review checks, in this order: that every item the milestone was to deliver exists, by path and test name; the rules that tests cannot see, read against the diff; the sweep, once at HEAD; and the numbers a decision rests on. It blocks only on a missing item, a failing check, a broken rule, behaviour that differs from a decision or a plan, or a wrong number. A follow-up looks only at the fix commits.
29. `three-attempts`: **Three attempts, then move on.** When the same failure survives three different attempts, stop that path. Record what was tried and the error, add a question if only the operator can unblock it, and go on with the next task that does not depend on it. The stopped task stays open, and the milestone's report names it.

## 5. Part B: everything a build makes stays under the repository's `.temp/`

### 5.1 What exists today

Most of this is already true. The layout, all inside the repository and all ignored by git (`startRecords` adds `.temp/` to `.git/info/exclude`, which every worktree shares):

| path | what | written by |
| --- | --- | --- |
| `<repo>/.temp/worktrees/<track>/` | a track's worktree, on branch `track/<track>` | `track_open` (`DEFAULT_WORKTREE_ROOT` in `schema/tracks.ts`) |
| `<worktree>/.temp/tally/run` | the runner script | `track_open`, `session_open` |
| `<repo>/.temp/tally/logs/<track>/` | the log of each run made through the runner; it is in the repository's own folder, so it outlives the worktree | the runner |
| `<worktree>/.temp/tally/results/` | a run's result, until the service's tick takes it | the runner |
| `<worktree>/.temp/<track>/landing/` | the landing's clean checkout | the landing |
| `<worktree>/.temp/<track>/tally/landings/*.log` | a landing's test log, when tally runs the tests | `land_run` |
| `<repo>/.temp/tally/state/` | sessions, claims and locks, only for a repository served alone with `--repo` | the server |

The service keeps its live state in its own data volume, outside every repository. That stays: it is not a build's output, and it dies with its session.

### 5.2 The gaps, and the changes

1. **`worktreeRoot` can point anywhere inside the repository.** `repo_configure` (`configureRepo` in `repos/configure.ts`) refuses a `worktreeRoot` that is not `.temp` or under it: `worktrees live under .temp/, which git ignores; '<given>' is not`. Check it there and not in the schema, so a config written earlier still reads.
2. **An agent is not told where its own scratch goes.** `session_open` and `track_open` answer `scratch`: `<worktree>/.temp/<track>/` (for an operator session, `<repo>/.temp/<main branch>/`), and create the folder. The description says: plans, notes, logs and throwaway scripts go there, never in `/tmp` and never in another hidden folder.
3. **A closed track's notes need a home.** `<repo>/.temp/closed/<track>/` (Part D).
4. **The rule.** The template's `scratch` rule (Part A) says it to every session.

Not changed, on purpose: a run's `TMPDIR`. `commands.tmpdir` already lets a repository point it under `.temp/` (`{track}` is replaced). Making that the default would put Unix socket paths past their 108-character limit in a nested worktree and break test suites that open sockets. The guide says how to set it.

### 5.3 Tests and docs

- `configure.test.ts`: `.temp/lanes` is accepted, `lanes` and `../x` are refused, and a config that already holds another root still reads.
- `session_open` and `track_open` answer `scratch`, and the folder exists.
- `GUIDE.md` gains the table above as "What a build leaves on disk".

## 6. Part C: phases, and one records commit per phase

### 6.1 What exists today

- **Three points commit waiting records**, in `packages/core/src/records/commit.ts` and its callers:
  - each write, through `commitRecords` (off when `records.batch` is true or `records.commit` is false);
  - the last session closing, in `state/end.ts` (only when `batch` is true);
  - a queue landing finishing (`land/turn.ts`, `recorded`) and any write made while no session is open (`packages/mcp/src/decorators/activity.ts`). These two flush whatever `batch` says.
- So with `batch` on, a `records:` commit still follows every landing. That is not once per phase.
- The second repository turned tally's commits off (`records.commit: false`) and its coordinator commits `docs/records/` by hand at each phase's end, with a `records:` subject so the ledger check passes over it. That is the habit the operator liked. It is why `session_close` answered `null` there.
- **A phase is not an object.** The config has `stages` (`id`, `name`, `weight`) and each milestone names its `stage`. A stage has no goal and no status, and no tool adds one, so the second repository kept the single default stage and named its milestones after its phases.
- No MCP tool commits waiting records. The CLI has `tally records commit`.

### 6.2 The records mode

One optional config key, `records.commitAt: "phase"`, read together with the two that exist. One function, `recordsMode(config)`, is the only place that reads them:

| `commit` | `batch` | `commitAt` | mode | records are committed |
| --- | --- | --- | --- | --- |
| `false` | any | any | `never` | never by tally |
| `true` | not `true` | any | `each` | at each write (today's default) |
| `true` | `true` | absent | `rest` | when the last session closes, when a landing finishes, and on a write with no session open (today's batch) |
| `true` | `true` | `"phase"` | `phase` | only by `phase_close` and `records_commit` |

- The three flush points in §6.1 go through one helper that does nothing in `phase` mode.
- A release that does not know `commitAt` reads such a config as `rest`, which is safe.
- `startRecords` gives a new repository `records: { batch: true, commitAt: "phase" }`.
- A records commit still waits while a landing has its turn, and is still made under the landing lock with the configured identity (`RULES.md` rule 7).

### 6.3 Phases

- **A phase is a stage.** The tools and the board say "phase". The config key `stages` and a milestone's `stage` field keep their names.
- **A new record, `docs/records/phases.json`:** `{ schema: 1, phases: [{ id, name?, weight?, goal?, decision?, openedAt?, openedBy?, closedAt?, closedBy?, summary?, commit? }] }`.
  - A phase added by a tool is stored here whole and joins the repository's `config.stages` when the repository is opened, the way a track tally opened joins `config.tracks` (`store/records.ts`, where `tracks.json` is merged).
  - A stage listed in `config.json` is a phase too. Its entry here is created when it is closed, and holds only its id and the closing fields.
- **`phase_add({ sessionId, id, name, goal, weight, decision? })`**, operator session only. The id must be new among the stages and the phases. `goal` is a sentence. `decision` is the id of the decision that approved the phase's plan.
- **`phase_list({ state?, sessionId?, repo? })`**, for any session: each phase with its id, name, goal, decision, state (`open` or `closed`), when it closed and its summary, how many of its milestones' tasks are landed, and `left`: up to ten sentences that say what still stops an open phase from closing. That is the evidence a session reports to the operator before a close. It runs the same checks as `phase_close` and writes nothing.
- **`phase_close({ sessionId, phase, summary })`**, operator session only, and only on the operator's word: a phase's end is a gate (template rule `operators-choices`). In order:
  1. Refuse an unknown or already closed phase.
  2. Refuse while a task of one of its milestones is not landed, naming up to ten.
  3. Refuse while `ledger_check` lists a commit on main that no record names, or a gap in one of the phase's milestones.
  4. Refuse while a landing for one of the phase's tracks is in the queue.
  5. Close each track tally opened whose tasks all belong to this phase's milestones, with Part D's close. A track that cannot be closed is named in the answer with the reason. It does not stop the phase from closing.
  6. Write the phase's `closedAt`, `closedBy` and `summary`.
  7. Commit everything waiting under `docs/records/` as one commit: subject `records: phase <id> closed, <n> record files`, body the summary. In `each` and `never` modes this step does what those modes say.
  8. Answer `{ phase, milestones, tasks, tracksClosed, tracksLeft: [{ name, why }], missing, commit }`. `missing` names each milestone of the phase with no build-log section. It is told, not refused. When a landing has its turn the commit waits: answer `commit: null` with `waits` saying so, and make sure the flush after that landing still happens in `phase` mode for a closed phase.
  9. Steps 1 to 4 write nothing. From step 6 on nothing is undone: if the commit fails, the answer carries `problem` with git's words, the phase stays closed, and `records_commit` makes the commit later.
- **A closed phase stays closed.** `milestone_add` and `task_plan` refuse it: `phase <id> is closed; later work goes in a new phase (phase_add)`.
- **`records_commit({ sessionId, why })`**, operator session only: commits what waits now, for the day the operator pushes in the middle of a phase. Its subject says how many files and why. It answers `{ commit, files }`, and `{ commit: null, files: 0 }` when nothing waits, which is not an error. In `never` mode it is refused (§8.4).
- **What waits is visible.** `ledger_check` and an operator session's brief answer `recordsWaiting: { files, since }`: how many files under `docs/records/` differ from HEAD, and the date of the last `records:` commit. Nothing nags.
- **The board** shows each phase's goal and, once closed, when. Keep the web change to that.
- **Everyone is told.** When a phase closes, each open session's inbox gets one line: `phase <id> was closed by <agent>: <summary>`.

### 6.4 Files and tests

| file | change |
| --- | --- |
| `packages/core/src/schema/config.ts` | `records.commitAt` |
| `packages/core/src/records/commit.ts` | `recordsMode`, the gated flush, a commit body |
| `packages/core/src/state/end.ts`, `land/turn.ts`, `packages/mcp/src/decorators/activity.ts` | call the gated flush |
| `packages/core/src/repos/start.ts` | a new repository's mode |
| `packages/core/src/schema/phases.ts`, `packages/core/src/phases/{file,add,close}.ts` (new) | the record and the two operations |
| `packages/core/src/store/records.ts` | phases join `config.stages` |
| `packages/core/src/ledger/ops.ts` | a closed phase refuses new milestones and tasks |
| `packages/mcp/src/tools/` (a new `phases.ts`), `meta.ts`, `params.ts` | `phase_add`, `phase_list`, `phase_close`, `records_commit` |
| `packages/server/src/watcher.ts`, `packages/web/src/` | the phase's goal and state on the board |

Tests to write first:
- `recordsMode` for the four rows; an older config with only `batch` is `rest`.
- In `phase` mode none of the three flush points commits: a write, the last session closing, and a queue landing finishing each leave `git log` as it was.
- `phase_add`: stored, visible in `config.stages` after a reopen, and usable by `milestone_add`; a duplicate id and a track session are refused.
- `phase_close`: each refusal in steps 1 to 4; a clean close makes exactly one commit that holds every waiting record file; a second close is refused; a landing in its turn makes it wait and the commit follows the landing.
- `phase_list`: an open phase's `left` names exactly what `phase_close` would refuse on, and is empty when it would succeed; it writes nothing.
- When the commit in `phase_close` fails, the phase is closed, the answer carries `problem`, and a later `records_commit` makes the commit.
- A closed phase refuses `milestone_add` and `task_plan`.
- `records_commit` commits in `phase` mode and answers `null` with nothing waiting.
- `startRecords` writes the new mode, and the first commit is still `records: start tracking`.
- The first tracked repository's shape still works: listed stages, `batch: true` and no `commitAt` behave as today.

## 7. Part D: a landed worktree that sits idle is removed

### 7.1 What exists today

- `track_close` (`packages/core/src/tracks/close.ts`) removes a track's worktree, its landing checkout and its local branch. It refuses a track listed in `config.json`, an open session, a held claim, a landing in the queue, a branch ahead of main, and uncommitted work.
- It also refuses when the worktree holds any ignored file tally did not write: `closing track X would delete ignored files tally did not write: node_modules, dist, …`. Every close in the second repository needed a hand-written `rm` first.
- Nothing closes a track by itself. Sessions expire after `sessions.idleMinutes` (240 by default) on the service's tick (`packages/server/src/watcher.ts`, which calls `expireSessions`), but their worktrees stay.
- Everything here is local. Tally never pushes and never deletes a remote branch. That stays.

### 7.2 `track_close` cleans up by itself

What is in a worktree, and what becomes of each when it closes:

| in the worktree | on close |
| --- | --- |
| a tracked file that was changed, or a file git neither tracks nor ignores | **refused**, as today, naming them: it may be work |
| a commit that is not on main | **refused**, as today |
| the track's scratch: everything under `<worktree>/.temp/` except tally's runner folder and the landing checkout | **kept:** moved to `<repo>/.temp/closed/<track>/`. If that folder exists, the close time is added to the name. Landing logs under `.temp/<track>/tally/` go with it, since the harness never deletes a log. |
| everything else git ignores: `node_modules`, `dist`, `target`, `coverage`, caches, logs, a copied `.env` | **deleted** with the worktree |
| the worktree, its landing checkout and its local branch | **removed**, as today |

- The check in `assertNothingToLose` that refuses ignored files goes. The other checks stay exactly as they are.
- The answer gains `cleaned` (the top-level names that were deleted, twenty at most, and how many there were) and `kept` (where the scratch went, when there was any).
- Today's code already relies on a plain `git worktree remove` deleting ignored files, since tally's own runner is one. Prove it with a test that leaves a `node_modules` folder. If git refuses, run `git clean -fdX` in the worktree first. Never pass `--force` to remove the worktree itself: that would delete uncommitted work.
- No run log is lost: the runner writes each log under the repository's own `.temp/tally/logs/<track>/` (`land/runner.ts`, where `$root` is the repository). Its results are in the worktree until the service's tick takes them (`takeResults`), so the tick takes results before it closes anything, as it does today by running first.
- `track_close` also refuses while a child of the track is still open, naming the child.

### 7.3 The service removes a landed, idle worktree

A new `closeIdleTracks(repo, now)` in `packages/core/src/tracks/idle.ts`, called on the service's tick right after `expireSessions`. A track is closed by it when all of these hold:

1. Tally opened it (`tracks.json`), and it is open. A track listed in `config.json` is never touched.
2. The ledger has at least one task of the track, and every one of them is landed. A track with planned work, or with none planned yet, is left alone.
3. Its branch is not ahead of main, and its worktree holds nothing uncommitted.
4. It has no open session, no claim, no landing in the queue and no open child.
5. It has rested for `worktrees.idleMinutes` (60 unless the config says), counted from the later of its last landing finishing and its last session ending.

- **The clock.** When a session ends, by `session_close` or by expiry, stamp the time for its track in the repository's live state (`statePath(repo, "tracks", "<name>.json")`). It is live state, not a record. The last landing's time is in the queue's tickets.
- **The close** is §7.2's, made by tally itself. `tracks.json` gains two optional fields: `closedBy` (`{ track, agent }`, with agent `tally`) and `closedWhy` (`landed, and idle since <time>`).
- **Who is told.** The parent track, or main when there is none, gets one note: `track <name> was closed: its work is on main and it sat idle for <n> minutes. Its notes are in .temp/closed/<name>.`
- **When it cannot close** because of step 3, it tells the same reader once, not on every tick, naming the files: `track <name> is landed and idle, but its worktree holds uncommitted files: …; commit them, delete them, or close the track yourself`. Keep "told" in the same live-state file.
- **Config.** A new optional key, `worktrees: { idleMinutes?: number, keep?: boolean }`. `keep: true` turns the automatic removal off for that repository.
- **A session that comes back** to a closed track's folder gets a refusal from `session_open` that says the track was closed because its work landed, when, and that new work needs a new track.
- A failure in one track never stops the tick or the other tracks: catch it, keep it for the service's log, go on.

### 7.4 Files and tests

| file | change |
| --- | --- |
| `packages/core/src/tracks/close.ts` | §7.2; the shared close that §7.3 and `phase_close` call |
| `packages/core/src/tracks/idle.ts` (new) | `closeIdleTracks` |
| `packages/core/src/schema/tracks.ts`, `schema/config.ts` | `closedBy`, `closedWhy`; `worktrees` |
| `packages/core/src/state/end.ts` | stamp the track's rest time |
| `packages/server/src/watcher.ts` | call it on the tick |
| `packages/mcp/src/tools/tracks.ts`, `params.ts` | `track_close`'s answer and description |

Tests to write first, on real git repositories as `packages/core/tests/tracks/` does now:
- A close with `node_modules/`, `dist/` and a `.log` succeeds and names them in `cleaned`.
- A close with notes under `.temp/<track>/` moves them to `.temp/closed/<track>/`, and a second track of the same name does not overwrite them.
- A changed tracked file, an untracked file that is not ignored, and a commit ahead of main each still refuse.
- `closeIdleTracks`: closes a track that meets all five conditions; leaves one for each condition that fails (a planned task, no task at all, an open session, a claim, a queued landing, an open child, not yet rested, a config-listed track, `keep: true`).
- The note is posted once when it closes, and once, not twice, when uncommitted files block it.
- A track that throws does not stop the next one.

## 8. The MCP surface, checked against the MCP builder skill

The plan was checked against the skill's best practices and its TypeScript checklist. This section is what that check added. The builder holds every new and changed tool to it. §8.8 lists where tally knowingly differs from the skill, so those are not "fixed" by accident.

### 8.1 Every tool the plan adds or changes

Seven tools are new, so the count goes from 55 to 58 after Part A and to 62 after Part C.

| tool | title | effect in `TOOL_META` | hints that follow | who may call |
| --- | --- | --- | --- | --- |
| `rulebook_get` (new) | Read the rulebook | read | read-only, idempotent | any session, or none |
| `rulebook_adopt` (new) | Bring the rulebook template | add, may be repeated | idempotent | operator session |
| `rule_tailor` (new) | Tailor a rule | add | none | operator session |
| `phase_add` (new) | Add a phase | add | none | operator session |
| `phase_list` (new) | List phases | read | read-only, idempotent | any session, or none |
| `phase_close` (new) | Close a phase | remove | destructive: it removes worktrees | operator session |
| `records_commit` (new) | Commit the waiting records | add, may be repeated | idempotent | operator session |

None of them reaches outside the machine, so none is marked open-world.

| tool (changed) | what changes |
| --- | --- |
| `context_put` | `section` and `source`, required for a rule and refused for any other kind |
| `session_open` | `brief.rules` slim and in rulebook order; `brief.tailoring` and `brief.recordsWaiting` for an operator session; `scratch` |
| `track_open` | answers `scratch` |
| `track_close` | deletes build output and keeps the notes; answers `cleaned` and `kept`; refuses while a child is open |
| `ledger_check` | answers `recordsWaiting` |
| `milestone_add`, `task_plan` | refuse a closed phase |
| `repo_configure` | refuses a `worktreeRoot` outside `.temp/`; takes `records.commitAt` and `worktrees` |
| `board_get` | each phase's goal and state |

### 8.2 Inputs

Every parameter gets its line in `params.ts`, with an example where a format is expected. The decorator already wraps each tool's shape in `z.strictObject`, so an unknown argument is refused by name.

| tool | parameters and their limits |
| --- | --- |
| `rulebook_get` | `section?` one of the four; `waiting?` boolean; `fields?` keys of an entry, such as `id` and `title`; `sessionId?`, `repo?` as on every read |
| `rulebook_adopt` | `sessionId` |
| `rule_tailor` | `sessionId`; `id`, such as `rule-9`; `source`, 1 to 200 characters on one line, such as `the operator, 2026-11-14` or `DEC-12`; `title?` up to 120; `text?` up to 2,000; `section?`; `paths?`, `tags?`, `refs?` up to 20 each, as on `context_put` |
| `phase_add` | `sessionId`; `id`, 1 to 40 letters, digits, `-` or `_`, starting with a letter or a digit, such as `G`; `name`, 1 to 80; `goal`, 1 to 500; `weight`, a positive whole number, the phase's share of the build's progress; `decision?`, 1 to 200 |
| `phase_list` | `state?` `open` or `closed`; `sessionId?`, `repo?` |
| `phase_close` | `sessionId`; `phase`; `summary`, 1 to 500 |
| `records_commit` | `sessionId`; `why`, 1 to 200 on one line |

Text that goes into a commit's subject (`why`, a phase's id) is trimmed and its whitespace folded to single spaces, the way `reasonOf` does in `ledger/remove.ts`, so a line break can never add a line to a commit message. Every git call passes its arguments as a list, never through a shell, as the code does today.

### 8.3 Answers

Each answer is compact JSON through `ok()`, like every other tool, and each is bounded:

| tool | answer |
| --- | --- |
| `rulebook_get` | `{ rules, waiting, template: { adopted, notAdopted } }`; whole entries unless `fields` says |
| `rulebook_adopt` | `{ added: [{ id, section, title }], waiting: [{ id, title, tailor }], already, commit }` |
| `rule_tailor` | `{ entry, retired, waiting, commit }`, which is `context_put`'s answer and one count |
| `phase_add` | `{ phase, commit }` |
| `phase_list` | `{ phases: [{ id, name, goal?, decision?, state, closedAt?, summary?, tasks: { total, landed }, left }] }`, `left` ten sentences at most |
| `phase_close` | `{ phase, milestones, tasks, tracksClosed, tracksLeft: [{ name, why }], missing, commit, waits?, problem? }` |
| `records_commit` | `{ commit, files }` |

Add `section` and `waiting` to the size cutter's set of narrowing parameters (`NARROWING` in `decorators/sized.ts`), so a cut `rulebook_get` answer says how to narrow it.

### 8.4 A refusal says what to do next

The wording follows what the tools say today. A refused call writes nothing.

| when | the refusal |
| --- | --- |
| a track session calls an operator tool | `only an operator session tailors a rule; a track that wants one changed asks a question with question_add` (and the same shape for the others) |
| `rule_tailor` on an id that does not exist | `no rule rule-99; rulebook_get lists the rules` |
| `rule_tailor` on a rule that was replaced | `rule-7 was replaced by rule-31 on <date>; tailor rule-31` |
| `rule_tailor` on a rule that was retired | `rule-7 was retired on <date> (<why>); a new rule is added with context_put` |
| `rulebook_adopt` where the rules are a Markdown file | `this repository's rules are its RULES.md (its config does not say context: "records"), so nothing was adopted` |
| `phase_add` with an id that exists | `phase G exists; the phases are A, B and G` |
| `phase_close` with tasks not landed | `phase G cannot close: 3 of its tasks are not landed (M7 / 2 export, …); land them, or remove a planned one with task_remove` |
| `phase_close` with commits the ledger lacks | `phase G cannot close: main has 2 commits the ledger does not record (abc1234, …); record each with task_land or task_other` |
| `phase_close` with a landing in the queue | `phase G cannot close: track exports has a landing in the queue (ticket 12); wait for it with land_wait, or cancel it with land_cancel` |
| `phase_close` on a closed phase | `phase G was closed on <date> by <agent>; later work goes in a new phase (phase_add)` |
| `records_commit` where tally's commits are off | `this repository turned tally's records commits off (records.commit is false); commit docs/records/ yourself, or turn them on with repo_configure` |

### 8.5 Descriptions

- A description says exactly what the tool does and no more. Each new tool's stays under 700 characters, and `session_open`'s under 1,600 after its additions.
- Measure `tools/list` before and after each part, and put both numbers in the commit body. It is about 63,000 characters for 55 tools today, and every agent session pays for it.
- Drafts for Part C's tools (Part A's are in §4.5):
  - `phase_add`: "Add a phase to the build (operator session only): a stretch of work with one goal, closed as a whole. Milestones are added to it with milestone_add, which takes its id as `stage`. `decision` names the decision that approved its plan."
  - `phase_list`: "The build's phases: each one's goal, whether it is open or closed, how many of its tasks are landed, and `left`, what still stops an open phase from closing. Report `left` to the operator before asking to close a phase."
  - `phase_close`: "Close a phase (operator session only, and only on the operator's word: a phase's end is their gate). Refused while a task of the phase is not landed, while main holds a commit the ledger does not record, or while one of its tracks is landing. It closes the phase's landed tracks, removing their worktrees, and commits every waiting record as one commit. A closed phase takes no new milestone or task."
  - `records_commit`: "Commit the record changes that wait on disk (operator session only), with `why` in the commit's subject. A repository that commits its records at each phase's end needs this only before the operator pushes in the middle of a phase."

### 8.6 The evaluation

The repository keeps ten questions over a fixture (`evaluations/fixture.py`, `evaluations/tally.xml`). They must still be ten, read-only, independent of each other, stable, and each with one answer that a string comparison can check.

- **Extend the fixture**, keeping it deterministic: adopt the rulebook; tailor two rules, one with new words and one kept as written; retire one template rule with a reason; add two phases with a milestone in each; land the first phase's tasks and close it.
- **One question breaks.** "Which rule applies to this file?" has many answers once the template's rules apply everywhere. Reword it to ask for the one rule written for that folder alone.
- **Replace up to three of the ten** with questions that need `rulebook_get` or `phase_list` and more than one call, for example: which rule now stands where a named template rule was first adopted; how many safety rules still wait for the project's own answer; what still stops the open phase from closing. Solve each one against the built fixture and write down the answer you got, not the one you expected.
- The skill's own evaluation script runs a model against the server and needs an API key. Running it is the operator's call. The answers are verified by hand either way.

### 8.7 Checks before a part is called done

- `meta.test.ts` lists the tools through a real client: every tool has a title, its hints and a description for every parameter. Add the new names to the list `server.test.ts` holds.
- For each new tool: one call that succeeds, one that is refused with the words in §8.4, and one with an unknown argument, which the strict schema refuses.
- A `rulebook_get` answer over the limit (a repository with 200 rules) is cut and its note names `section` and `waiting`.
- The private end-to-end driver runs against the freshly built image: the handshake, the tool count, and one call of each new tool.

### 8.8 Where tally knowingly differs from the skill

| the skill says | tally does | why it stays |
| --- | --- | --- |
| prefix every tool with the service, `tally_…` | `<noun>_<verb>`, no prefix | 55 tools are named so, and agents in two repositories call them by name. A client already prefixes a tool with its server's name. |
| offer JSON and Markdown answers | compact JSON only; `context_pack` also carries text | tally is built for agents, settled on 2026-11-12 |
| declare an `outputSchema` | none | none of the 55 has one; adding it to seven would split the surface. It is a task of its own. |
| use SDK v2 (`@modelcontextprotocol/server`) | SDK v1, `@modelcontextprotocol/sdk` 1.32.2 | v2 is the current stable release and v1 gets fixes only. `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` migrates a project. It is a task of its own, not part of this plan. |
| answer `has_more` and `next_offset` on a list | `matched` beside `limit`, and the size cut's own note | the tools' standing convention |

## 9. Order, and what done looks like

**Order: A, then B, then D, then C.** A and B are independent of the rest. C's `phase_close` calls D's close, so D lands first. Each part is its own worktree and branch under `.temp/worktrees/`, reviewed and fast-forwarded before the next starts, because all four touch `meta.ts`, `params.ts`, the config schema and the guide.

Each part is done when:
- its tests were written first and seen failing on their assertions, and now pass;
- `npm run typecheck` and `npm test` pass on its branch (1,105 tests before this plan; none removed or weakened);
- no source or test file is over 400 lines, and no source file has a comment;
- an independent review found nothing critical or high, and its medium findings are fixed with tests;
- every tool has its title, its effect and a description for every parameter (the decorator refuses a tool with no entry in `TOOL_META`), and holds to §8;
- the documents say it: `GUIDE.md` (§10.8 for A, a new "What a build leaves on disk" for B, a new section on phases for C, §10.5 for D, whose `track_close` bullet still lists ignored files among the refusals), `RULES.md` (rule 7 for the records modes, rule 10 for what a close deletes and keeps), `README.md` (the tool count: 58 after A, 62 after C), `DESIGN.md` §16 and §17.4, and the private copy of the design;
- the private drivers pass against the new build: `.temp/e2e/drive.py` (the tool count it expects, and one call of each new tool) and the evaluation fixture.

The whole plan is done when all four are on `main`, the tracked files and the new commit messages hold none of the private words §2 points to, and nothing was pushed.

## 10. Rolling out

1. In the main checkout: `npm run build`, then `docker build -t tally:local .`. The host's `tally` command and the first tracked repository's scripts use that build.
2. Ask the operator to recreate the service (`docker compose up -d`). Do not do it unasked. Agents see the new tools after their client reconnects.
3. Nothing changes in a tracked repository until its own operator session acts, on the operator's word:
   - **The second repository** can switch its records to `{ commit: true, batch: true, commitAt: "phase" }` with `repo_configure`, add its phases with `phase_add`, and bring the rulebook with `rulebook_adopt`. Its `rule-1` says its own `RULES.md` is the sole rulebook, so that session and the operator decide which wins before adopting.
   - **The first repository** is untouched by all four parts: its rules are its `RULES.md`, its tracks are listed in its config so nothing closes them, and its records stay in today's batch mode.
4. One caution on versions: a release from before Part A drops the four new fields if it rewrites `rule.json`. The service is the only writer of context, so recreate it before any repository adopts the template.

## 11. What the review asked for that this plan leaves out

| the review's point | here |
| --- | --- |
| A schema per record kind; refuse decision-shaped text in a rule | Part A gives rules a section and a source. Refusing by wording is left out: it needs the next row first. |
| Decisions and answers over MCP (`decision_propose`, `question_answer`) | Not planned. Today they are written from the board or the CLI. |
| `ledger_check` validating that answers cite decisions and rules cite sources | Not planned. |
| Tally rendering the plan's Markdown tables | Not planned. It runs against the settled direction that no Markdown file is context. |
| Refuse a read that names no repository | Not planned. It is small and worth doing next: a call with no session and no repository reads the default repository today. |
| Phase as an object, with `phase_close` | Part C. |
| `track_close` cleaning build output | Part D. |
| Short session ids; a notice when a landing ends, in place of polling `land_wait` | Not planned. |
| Stale sessions and claims | Already there: a session idle for `sessions.idleMinutes` (240 by default) is ended on the service's tick and its claims released. The review's run predates it or outlasted it; lower the number per repository. |
| Briefs by need | Part A slims the rules in the brief and protects them from the size cut. The rest is not planned. |
| A dated build level above phases | Not planned (§3, row 7). |
