# Tally: version 2 of the MCP SDK, both protocol revisions, and a trial of asking the person

**Written:** 2026-11-21 10:51 IST (2026-11-21 05:21 UTC)
**Base:** `main` at `cbf8661`, version 0.9.1 (2,153 tests in 299 files, 81 MCP tools, `tools/list` 79,623 characters and 78,313 where no command runs; the builder's list 25,647 and the reviewer's 18,094).
**Status:** built on 2026-11-21 as version 0.9.2 with its fix round, 0.9.3, in the 34 commits from `f442735` to `354dc7a` (2,301 tests and one gated check in 323 files, 81 MCP tools, `tools/list` 79,623 characters and 78,313 where no command runs, the same byte for byte as 0.9.1). In the service since 2026-11-21, about 16:33 IST. Every part is built. The text below is the plan as it was written before the build. Where the build differs:
- **The version is 0.9.3.** The parts were built as 0.9.2 and reviewed. A fix round followed the review of the whole tip, and by the operator's counting that round is the next number. 0.9.2 was not released by itself.
- **No listen stream is held** (row 7 of section 3, and B.3). This plan assumed that a `subscriptions/listen` stream stays open, to be held and let go. That was wrong. The SDK ends such a stream at once when the server declares `tools.listChanged: false`, and the operator's client, told `false`, opens none: it was run against both declarations. Tally declares `false` on both revisions, which is true, and holds nothing for a session. B.3's measure with 50 held streams was taken before that and describes a service that does not exist.
- **The stop** (B.2). Closing the SDK's handler aborts a 2026-07-28 call in flight, which this plan did not know. A stop waits up to five seconds for the calls in flight on both revisions, names in the log each call it gives up on, and cuts what is left half a second later; the cut is armed when the stop begins, so a request whose body never arrives cannot hold it. A request that arrives meanwhile is refused with 503 and a sentence that says to call again. A request that meets a handler closed under it, because its repository left the list or was listed again at another folder, is handed to the handler that serves the address now.
- **An older client's GET** is held only while its event stream is open, so a refused one holds nothing. Such a stream now carries a keep-alive comment every 15 seconds, which comes with version 2 of the SDK.
- **The handler's `responseMode` is the SDK's default, `auto`,** and not `json` (B.1). With `json` the SDK warned on the console each time a handler was made. No tool of tally sends a message before its result, and a test holds every answer on 2026-07-28 to one JSON body.
- **The server of one repository** has the service's guard and answers an error as the service does. This plan did not ask for that; the review did.
- **Part C's tests** drive the command's own function over pipes, and not the built command, since no test depends on a build. `npm run smoke` and the private driver run the built command.
- **Part E took two changes.** After the first, one line of the Overall panel still ran under the Graph panel at a window of 1024 px with the list open; the fix round cured it.
- **F.1** is one window of 30 seconds for every test, in place of a longer time on each test that runs git. Its proof at the end also found a real leak, a watcher started after the hub's stop, which is fixed.
- **F.3** is in the three functions this plan named and nowhere else, and one of them has no caller.
- **The sealed state of `ask_trial` lives an hour;** this plan named no time.
- **Found by the review and left as in 0.9.1:** on stdio an answer still pending when the input ends is not written, and `tally mcp` does not end when its input closes with an error.

`DESIGN.md` section 26 has each of these, with what was measured.
**Builds as:** one release, 0.9.2, by one builder on one branch.
**Checked:** against the installed SDK (2.4.0) and against a real client on 2026-11-21, which section 1 reports; against the MCP builder guide's page for version 2 of the SDK on the same day, which is section 8.
**This repository is public.** This file names no private project. Keep it that way when you edit it: the private names and paths are in the local notes, which git ignores.

## 1. What this answers

The plan of 2026-11-20 left three things out that this one takes up, and the operator added a fourth:

1. **The move to version 2 of the SDK** (that plan's section 11). The operator set the order during that build: the fixes as 0.9.1, the SDK as 0.9.2.
2. **Asking the operator through the client's own dialog** (the same section). It was left out because nobody had a client at hand to try it with. This plan builds a trial of it and nothing more.
3. **Small items the 0.9.1 build left open**: tests that depend on the machine being quiet, small objects that still drop a key they do not know, writers that do not refuse a closed cycle's folder, and one test that cannot fail.
4. **A layout flaw in the board**, found when 0.9.1 went into the service: in the wide layout the page tabs can be covered. The operator's answer on 2026-11-21: fix it "With 0.9.2".

### What was established before writing

A throwaway trial moved tally to the new SDK on a branch that is never merged. Its report is in the local notes. The planner then checked its main claims first-hand. What is known:

- **Versions.** `@modelcontextprotocol/server`, `client`, `core` and `codemod` are at 2.4.0 on the registry. `@modelcontextprotocol/sdk` is at 1.32.2 and receives fixes only. Tally declares `^1.24.0`.
- **The move is small.** The official codemod rewrites imports in 27 files of `packages/mcp`. A handful of hand changes then give a green suite and a `tools/list` that is the same byte for byte: 81 tools and 79,623 characters. `packages/server` and `packages/cli` import nothing from the SDK.
- **Two eras of the protocol.** Version 2 of the SDK serves the revision 2026-07-28 (no `initialize`; a `_meta` envelope on each request; `server/discover`) and the 2025 revisions that tally serves today. The codemod alone keeps tally on the 2025 revisions.
- **The trap.** The SDK's own HTTP entry answers a 2025-era request as an event stream, whatever its `responseMode` says. Its typings say that `responseMode` shapes "modern (2026-07-28) request exchanges" only. The planner ran a bare `tools/call`, with no handshake, against the installed SDK:

  | handler | status | content type |
  | --- | --- | --- |
  | `createMcpHandler(build, { responseMode: "json" })`, the 2025 leg it serves by default | 200 | `text/event-stream` |
  | the same with `legacy: "reject"` | 400 | `application/json`, error `-32022` |
  | the 2025 transport the codemod keeps, with `enableJsonResponse` | 200 | `application/json` |

  The first tracked repository's script sends exactly that bare call and reads the answer as one JSON value. Served by the first row, every one of its calls would fail.
- **The way out is the SDK's own.** Its typings describe it: route with `isLegacyRequest` in front of a `legacy: "reject"` handler, and keep the existing 2025 wiring beside it. The trial did that and its script check passed.
- **A call to a tool the address does not serve changes.** It was a tool result marked as an error, with the text `MCP error -32602: Tool <name> not found`. Under version 2 it is a protocol error `-32602` with the text `Tool <name> not found`. The planner saw the new form on the 2025 leg.
- **What a real client does.** Claude Code 2.1.327, checked on 2026-11-21 against a throwaway listener built on SDK 2.4.0:
  - It asks `server/discover` on 2026-07-28 **first**. A server that answers stays on that revision for the whole connection. Today's service does not answer it, so the client falls back to `initialize`.
  - Its envelope declares `elicitation` with `form` and `url`. A headless run declares it too.
  - It opens a `subscriptions/listen` stream at once and holds it.
  - When a tool answered `input_required` in a headless run, the client answered `cancel` in 7 milliseconds and called again. The tool saw a clean cancel. Nothing hung.
  - Not seen: what a person at the screen is shown, and what a person following the session from another device is shown.
- **In tally's code.**
  - `mcpHandler` is built on every request at two of its four call sites (the per-repository addresses and the role addresses). That is harmless today and wrong once a handler holds listen streams.
  - The service already refuses a request whose `Host` is not the loopback address or whose `Origin` is another site (`loopbackOnly`, on every route).
  - The count of calls keeps its numbers across a new version: the file gains a line per version served.
  - When the service stops it closes idle connections; an open stream is not idle.

**What follows from the client check.** From the day tally serves 2026-07-28, every Claude Code session uses it, because the client asks for it first. The 2025 path stays for the first tracked repository's script and for any older client. So the new path is the main one from its first day, and it is built and checked as the main one.

## 2. Read this before building

- **The standing rules** are in the local notes: `CLAUDE.local.md` and the file it includes. Neither is in git. The ones that bite here:
  - Commit with the repository's one identity, which the local notes give, and with no attribution line. Never push.
  - Never start `tally serve` on any port, and never recreate, stop, retag or restart the Docker service. Ask the operator each time.
  - Never call the live service's MCP tools, and never read or edit another repository's files.
  - A design change goes in `DESIGN.md`, with generic names.
- **The house rules** are `RULES.md` rule 12: the test first, seen failing on its assertion; no comments in TypeScript source; source and test files under 400 lines; immutable updates; errors as `TallyError`.
- **How a change is built here:** in the worktree cut for it under `.temp/worktrees/`, on its own branch, after `npm ci` there. Never in the main checkout, and never by moving `main`.
- **A trap of that worktree.** It sits inside the main checkout, so Node and `tsc` fall back to the main checkout's `node_modules`, which still holds version 1 of the SDK. A leftover version 1 import can typecheck and run there without anyone noticing. Part A.2 has the guard.
- **The trial branch is reading matter.** Read its diff for what the move needs. Do not merge it and do not cherry-pick from it: each change here is made again from its own failing test.
- **Stored formats stay readable by the previous release** (`RULES.md` rule 8). This release changes no stored format.
- **Tally suggests and enforces mechanical rules; it decides nothing.** The trial tool of Part D writes nothing and decides nothing.
- **A weakness is proved before it is fixed.** If a test for an item of Part F cannot be made to fail, the weakness is not real: leave the code alone and list the item under `NOT NEEDED` in the final report, with what the test showed.
- **The suite under load.** With the machine busy, a few tests that wait on a clock fail at full parallelism and pass alone. Until F.1 is done, a clean run is `npx vitest run --maxWorkers=4`.
- **Before the operator pushes,** scan the tracked files and every new commit message for the private words the local notes list.

## 3. Decisions taken, which the operator may change

Each is cheap to change before its part is built and costly after.

| # | question | taken |
| --- | --- | --- |
| 1 | What 0.9.2 is. | **The SDK move, both protocol revisions, a trial of asking the person, the page tabs, and four small items.** No tool is added to any list, and no stored format changes. |
| 2 | Whether to serve 2026-07-28 now, or only move the package and keep serving the 2025 revisions. Moving the package alone changes nothing an agent can see. | **Serve both.** The client the operator uses asks for 2026-07-28 first, and a tool can ask the person only on that revision over tally's HTTP addresses. The cost is that the new path carries every Claude Code session from the first day. |
| 3 | How a 2025-era request is answered. | **Exactly as 0.9.1 answers it:** one JSON body, by the transport the codemod keeps, behind the SDK's own classifier. The SDK's default 2025 leg is not used, because it answers as an event stream. |
| 4 | Asking the person. | **A trial only:** one tool at its own address, which asks, answers what happened and writes nothing. `cycle_close` and `decision_record` do not change. What a person at the screen, and a person on another device, is shown has not been seen, and the design of the real thing depends on it. |
| 5 | A test with a real client of SDK version 1. It brings version 1 back as a package for tests only. | **Kept, for one test file.** It is the truest check that an older client still connects. The image is built without packages for tests, and the driver checks that. |
| 6 | The changed answer for a tool the address does not serve. | **Accepted as the SDK's.** The guide gains a sentence. Tally does not wrap it. |
| 7 | Listen streams. | **Served, and tally announces nothing on them.** The tool list changes only with a release. |
| 8 | The limits on `tools/list`. | **Unchanged:** 80,000 for the whole list, 30,000 for a builder's, 22,000 for a reviewer's. The list stays the same byte for byte, and Part A.1 makes that a test. |

## 4. The parts

### Part A. The move itself, with nothing else changed

The end of this part is a commit where tally runs on version 2 of the SDK and behaves as 0.9.1 does, on the 2025 revisions only. It is green before Part B begins.

**A.1 A record of 0.9.1's surface, written first and kept.** Before any package changes, add tests that pass on `cbf8661`:

- **A fingerprint of the tool list.** The SHA-256 of the compact JSON of the `tools` array, read over the wire through the service app, at `/mcp`, `/mcp/builder`, `/mcp/reviewer`, a per-repository address and a per-repository role address, and where no command runs. The recorded values are those of 0.9.1. The failure says that the list changed, and that a change that is meant updates the fingerprint in the same commit with the reason. Control: one character changed in one description fails it.
- **The wire answers an older client gets.** For a POST with no handshake, as the first tracked repository's script sends it: the status, the content type, that the body is one JSON value, and for a read that names no repository that its text part is one JSON value with `repo` inside. The same for a refused call (an unknown argument, a session that does not exist). The status of a GET and of a DELETE. At each address above.

These stay green through every later commit, except the one answer A.4 names.

**A.2 The packages.**

- Run the codemod and fix what it marks.
- `packages/mcp` depends on `@modelcontextprotocol/server`. The `client` and `core` packages are for tests only. `@modelcontextprotocol/sdk` is no longer a dependency of any package that ships.
- `zod` is `^4.2.0` or later in every package that declares it, and one copy is installed.
- **The guard, as a test:** no file under `packages/*/src` or `packages/*/tests` imports from `@modelcontextprotocol/sdk`, except the one test file of decision 5. And once, by hand, before trusting a green run: the SDK the worktree resolves is the worktree's own copy.

**A.3 What the trial needed by hand.** These are hints, not orders; the tests decide.

- The helper that turned a schema into JSON Schema is gone from the SDK. zod's own `toJSONSchema` gives the same output for every tool once `$schema` is stripped, which tally already does.
- The SDK now types `structuredContent` loosely. Tally always sends an object and keeps its own narrower type.
- The test helper that calls a tool must turn the SDK's protocol error into the shape the tests read.

**A.4 The one answer that changes.** A call to a tool the address does not serve is a protocol error `-32602` with the text `Tool <name> not found`. Update the tests that read it and say so in `GUIDE.md`, where a role's tool set is described.

**Must hold at the end of A:** typecheck clean; the suite green; the fingerprints unchanged; every refusal text of A.1 unchanged; the same 81 tools.

### Part B. Both revisions over HTTP

**B.1 Routing.** A request is classed by the SDK's own `isLegacyRequest`.

- A 2025-era request is answered by the transport the codemod keeps, with a JSON answer, from a fresh server. This is what 0.9.1 does.
- A 2026-07-28 request is answered by the SDK's entry with `legacy: "reject"` and `responseMode: "json"`.
- Test first, at every address of A.1:
  - the plain POST of A.1 is still one JSON body. **Control:** served by the SDK's default 2025 leg it is an event stream, and the test fails. Run the control and say so in the progress file.
  - a raw `initialize` at 2025-03-26, 2025-06-18 and 2025-11-25 connects, lists and calls.
  - a client of SDK version 1 connects, lists and calls (decision 5).
  - a client of SDK version 2 pinned to 2026-07-28 connects, lists and calls, and sees the same list and the same refusal texts.
  - an `initialize` that offers 2026-07-28 is answered with 2025-11-25, as today.

**B.2 One handler for each address, made once.** A handler of the new revision holds its listen streams, so it cannot be made on every request.

- Each address of each repository has one handler, made on first use and kept.
- A repository that is removed from the list, or listed again at another folder, is never served by a handler made for the old one. Its handler is closed.
- Stopping the service closes every handler.
- Test first: many requests to one address make one handler; a repository removed and listed again at another folder is read from the new folder; stopping closes them all.

**B.3 Listen streams.** The client opens `subscriptions/listen` at once and holds it.

- The stream stays open and carries the SDK's keep-alive. A call on another request is answered while it is open.
- When the client goes away, what the stream held is released.
- The service stops within two seconds with streams open. Test first; today the stop waits for connections to become idle.
- Measure and report, without a test: 50 streams held for a minute beside 500 calls, then closed; the process's memory before and after.

**B.4 The same service on both revisions.** A representative set of the existing tests runs on each revision, not the whole suite twice:

- the call is counted once, with the same `via`, and a refused call is counted as `invalid`;
- the 25,000-character cut and its note;
- the hints for `cwd` and `repo`;
- a role address serves its set, and a repository's address reads that repository;
- a write is refused while a cycle's close is unfinished;
- the guard: a request with another `Host`, or from another site's page, is refused on both revisions and for a listen stream.

**B.5 What the new revision adds around an answer.** The SDK adds a result type and the server's name to each answer, and cache fields to the list. Measure both and write the numbers in `DESIGN.md`. They are outside the `tools` array, so the limits of decision 8 do not count them.

**B.6 Limits of the SDK that now apply.** A body over the SDK's bound (4 MiB by default) is refused, and a POST that is not JSON is refused. Both hold on both revisions, with one number, and `DESIGN.md` says so.

### Part C. Both revisions on stdio

- `tally mcp` serves both revisions through the SDK's stdio entry, which pins a connection to the revision of its first exchange.
- **The command ends** on the end of its input, on SIGINT and on SIGTERM, as in 0.9.1. It also ends when its output can no longer be written, for instance when the host has gone: the SDK's entry gives nothing to wait on for that, and the trial left it open. Test first: with the output destroyed, the command ends. Control: without the fix it does not.
- **The count is written** before the command ends, on each of those paths. The driver's step for it stays green.
- Test first: a client pinned to 2026-07-28 and a raw 2025-03-26 exchange each list and call through the built command.
- **A self-check in the repository,** as the builder guide asks: `npm run smoke` starts the built command on a scratch repository, lists the tools and calls one read on each revision, checks one refusal, and exits non-zero on a failure. `README.md` names it.

### Part D. A trial of asking the person

**What it is for.** A tool can now answer that it needs the person's input. The client asks the person and calls the tool again with the answer. That would let the operator's own words reach tally from their own hands, where today an agent quotes them in `said`. Before that is designed for a cycle's close and a decision, the operator has to see what each of their clients shows.

**D.1 The pipeline.** Tally's decorators read an answer's content, and a round that asks has none. Without a change the call fails and nobody is asked: the trial saw this.

- A round that asks goes back to the client as it is. It is not counted, not logged as activity and not cut.
- The call that finishes is treated as any call is.
- This holds for every tool, though only the trial tool asks.

**D.2 The tool.** `ask_trial`, served at `/mcp/ask` and nowhere else.

- It is in no other list: the fingerprints of A.1 do not change. It is not counted, so the ranking of tools stays clean.
- Input: `about`, a short text.
- It asks with a form: `confirm`, a yes or no, and `said`, the person's own words.
- It writes no record and changes nothing.
- Its answer says what happened:
  - `asked: true` with `action: "accept"`, `confirmed`, `said` and `waitedMs`;
  - `asked: true` with `action: "decline"` or `"cancel"`, and a sentence that a client with nobody at hand answers `cancel` at once;
  - `asked: false` with the reason, where tally can tell beforehand that the connection cannot carry a question (a 2025-era request at a stateless address, or a client that declares no elicitation). Where it cannot tell, the SDK's refusal stands, if it reads clearly.
- An accepted form with `confirm: false` is an answer. It does not ask again.
- **What was asked travels sealed.** The first round seals `about` and the time into the request's state, with the SDK's codec and a key made when the process starts. The finishing round answers from the sealed state, not from the second call's arguments. A state the process cannot open, because the service was restarted meanwhile, is refused with a sentence that says to call again.

**Test first:** accept; decline; cancel; `confirm: false`; a client with no elicitation; a 2025-era request at the address; second-call arguments that differ from the first, where the answer shows the first; a state sealed by another key.

### Part E. The page tabs

In the wide layout the middle panel's head holds its title and five tabs and does not wrap, and the middle column may shrink below what that needs. The panel then runs under the Graph panel.

- Seen on 0.9.1 with the repositories list open: at 1024 px wide, Cycles, Evidence and Docs cannot be clicked; at 1150 and 1280 px, Docs cannot. From 1366 px, or with the list collapsed, all can.
- **Must hold:** at 1024, 1150, 1280, 1366 and 1440 px, with the list open and with it collapsed, each of the five tabs is the element at its own centre, no panel lies over another, and the page does not scroll sideways. The narrow layout does not change.
- A component test cannot measure layout. The proof is the planner's look in a browser (section 7). Say in the progress file what was changed and why it holds.

### Part F. Small items

**F.1 Tests that wait on a clock.** Under load, tests in the files named `expire-log`, `lock-lost`, `live`, `board-open`, `board-scope`, `roles`, `start-service` and `usage`, and one case of `sized`, have failed in a full run and passed alone. Several packages have a file of some of those names, and the notes do not say which.

- First run the proof below on the base as it is, and list what fails. That list is the work.
- For each, find why it depends on timing and remove the dependence: a clock handed in, a wait for a condition instead of a fixed sleep, or a window that does not assume a quiet machine.
- The product's own timings do not change. A test whose timeout is raised says why in its name or its helper.
- **Proof:** the whole suite five times in a row at full parallelism, while a second copy of the suite runs beside it. All ten runs are green. Report each test's cause in one line.

**F.2 The small objects that say who.** `openedBy` and `closedBy` on a track and on a phase are strict, so a key a later build adds is dropped when this build rewrites the file. Read them loosely and keep what is not known, as the records around them already do. Look for other nested objects of the kind and say what was found. Test first: a file with an unknown key inside one is rewritten with the key still there.

**F.3 The functions that write `tracks.json`, `phases.json` and `cycles.json`** take a folder and do not themselves refuse a closed cycle's folder. No tool hands them one. Make them refuse it. Test first.

**F.4 A test that cannot fail.** The test of the landing's stop that checks the group leader passes with or without `--wait`, because the shell forks before `setsid` runs. Replace it with one that fails when the script is wrong, or remove it and say so.

## 5. In the release

- **Versions.** Every `package.json` and the lock file carry 0.9.2, and both revisions answer it. No listed tool is new, so no `since` changes.
- **The documents.**
  - `DESIGN.md` gains section 26 in the form of sections 20 to 25: the decisions, each part as built, what was measured, what was left out. Its table of packages names the new SDK package.
  - `GUIDE.md` gains what an agent must know: the two revisions, the changed answer of A.4, and the trial's address.
  - `README.md` changes where it names the SDK, and gains `npm run smoke`.
- **The checks at the end:** `npm run typecheck`; the whole suite, by F.1's proof; no source or test file over 400 lines; no comment in source; the fingerprints and the limits; a scan of the commits for the private words.
- **The image and the driver.** Build the image as `tally:candidate-092` and nothing else: never tag `tally:local`. Run the private end-to-end driver against it with its own scratch folder. Extend it with steps on 2026-07-28 (discover, list, a call, a refusal), and with a step that the image holds neither version 1 of the SDK nor the web framework it brought.
- **Commits.** One per item or smaller, each with the tests that prove it, in the form the log already uses. The version and the documents are the last commits.
- **The report.** Per part: what changed, its commits and its tests. Then every `DEVIATION`, `NOT NEEDED`, `NOT DONE` and `NEEDS THE PLANNER`, what the builder is least sure of, and the counts: tests, files, tools, the sizes of the three lists, the image's id, the driver's steps.

## 6. The order of work

1. A.1, on the base as it is. Then A.2 to A.4. Part A is green and committed before anything else.
2. F.1, because every later check runs the whole suite.
3. B.1, then B.2 and B.3 together, then B.4 to B.6.
4. C.
5. D.
6. E, F.2, F.3, F.4.
7. The release.

After each item the builder writes one line to the progress file the hand-over names: the item, its commits and the suite's count. A run that is paused is continued from there.

## 7. The planner's checks, with a real client and a browser

Tests through SDK clients do not show what the operator's client does, and nothing but a browser shows a layout. The builder adds one gated test for the planner to use: skipped unless `CHECK_PORT` is set, it serves the service app, its pages included, with two scratch repositories on `127.0.0.1:<CHECK_PORT>` for `CHECK_SECONDS`, writes each MCP request's method, revision and status to the file `CHECK_OUT` names, and refuses port 47560. It is the test harness with a port, not `tally serve`.

With it the planner checks, before asking for the recreate:

- the installed Claude Code connects on 2026-07-28, holds its listen stream, lists the tools A.1 records, calls one, and is shown the refusal of A.4 in a form its model can read;
- the same at a role address;
- `ask_trial` in a headless run answers `cancel`;
- a copy of the first tracked repository's script, kept in the local notes, prints what it prints against 0.9.1;
- the pages of Part E at the five widths.

## 8. Against the MCP builder guide

- **Followed here:**
  - The package is `@modelcontextprotocol/server`, with zod 4.2 or later, and nothing imports version 1 outside one test.
  - The factory returns a new server for each request. It already did.
  - HTTP is served stateless and in JSON, which is the guide's own recommendation.
  - `Host` and `Origin` are checked on every route by tally's own guard, and B.4 tests it on both revisions.
  - A self-check runs against the built server (Part C).
  - A notification is sent only when the server's capabilities change: tally sends none.
- **Not followed, on purpose:**
  - **A transport wired by hand** for 2025-era requests, which the guide says a version 2 server should not have. It is the only way those answers stay JSON. The SDK's typings describe this routing for keeping an existing deployment, and B.1's test is the tripwire if a later 2.x drops the transport.
  - **The SDK's Express app and its adapters.** Tally serves the web-standard handler from Hono directly, and its own guard does what the Express app's checks do.
  - **`import * as z from "zod/v4"`.** Tally imports `zod`, which is version 4.
  - Markdown answers, a service prefix on tool names, pagination by offset and output schemas: as section 9 of the plan of 2026-11-20 says.

## 9. What the operator should know before the service is recreated

- **From the recreate on, Claude Code sessions talk to tally on 2026-07-28.** The first tracked repository's script and any older client keep the path they have, answered as today.
- **No stored format changes.** Going back to 0.9.1 is free at any time.
- **A session that is open across the recreate** keeps working. Tally keeps no connection state on either revision.
- **The host's command line.** Once 0.9.2 is on `main`, `npm ci` and `npm run build` in the main checkout are one step. `npm ci` alone replaces the installed packages under the old build, which needs the old ones.
- **The role addresses are unchanged.** `/mcp/ask` is new and serves only the trial.
- **Other clients** than Claude Code were not checked. Either revision serves them; which one they ask for is not known.

## 10. Left out

- **Asking the person on `cycle_close` and `decision_record`.** It waits for what the trial shows. Its design will have to settle: what tally itself writes in the question, since the trial's text comes from the agent; what a cancel means where nobody is at hand; whether a decision the person accepted in the dialog counts as confirmed; and whether the client's `url` form, which could open the board's own page, serves better than a form.
- **A 2025-era wiring with sessions,** so that an older client could be asked over HTTP. It would put connection state on the service, and the operator's client does not need it.
- **Cache hints for the tool list** on the new revision. The list is small to fetch and changes only with a release.
- **A refusal of tally's own for a tool outside a role's set,** which would say which address serves the tool.
- **Shortening the time a cycle's close holds the ledger's and the tracks' locks** while it removes closed lanes' folders. A write made meanwhile waits up to 30 seconds and is refused with nothing changed. The close was reviewed three times and is left as it is until a close is seen to take long.
- **Removing tools and lowering the 80,000.** That waits for the ranking, which needs use. The count carries over the upgrade.
- **Output schemas, and command-line verbs for the newer tools.** As before.
- Two things the builder of 0.9.1 was least sure of, known and left: a release's tasks are matched by short commit hash, and a brief that could not be made is answered as a note in `session_open`, not as an error.

## 11. What only the operator orders

Not for the builder.

1. **Recreating the service** on `tally:candidate-092`, after the planner's check, with the 0.9.1 image kept under a rollback tag.
2. **Trying `ask_trial`** in each place they work: add `/mcp/ask` to one session as a server of its own, have the agent call the tool, and note what happened. At the desk in the app. In a terminal session. From another device while the session runs at the desk. From a sub-agent or a headless run. For each: was a question shown, where, could it be answered, and what did the tool answer. Then remove the server from the session. The next plan is written from those notes.
3. **Rebuilding the host's command line** (section 9) and setting `TALLY_URL` where the first tracked repository's scripts call it.
4. **Pushing.**
