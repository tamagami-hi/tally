import { describe, expect, test } from "vitest";
import { sessionBrief, unlandedTasks } from "../../src/context/brief.ts";
import { putEntry, retireEntry } from "../../src/context/entries.ts";
import { adoptRulebook, tailorRule } from "../../src/context/rulebook.ts";
import { RULEBOOK } from "../../src/context/rulebook-template.ts";
import { setProject } from "../../src/context/project.ts";
import { writeHandoff } from "../../src/records/handoffs.ts";
import { addQuestion } from "../../src/records/questions.ts";
import { startRecords } from "../../src/repos/start.ts";
import { configureRepo } from "../../src/repos/configure.ts";
import type { Ledger } from "../../src/schema/ledger.ts";
import { claimTask } from "../../src/state/claims.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records, openRepo, type Repo } from "../../src/store/records.ts";
import { DATA, OPERATOR, keepingContextAsRecords } from "../support/context.ts";
import { makeRepo } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const withPaths = (repo: Repo, track: string, paths: string[]): Repo => ({ ...repo, config: { ...repo.config, tracks: repo.config.tracks.map((t) => (t.name === track ? { ...t, paths } : t)) } });

describe("a session's brief", () => {
  test("carries the project, the rules in force, the track's tasks that are not landed, its hand-off, who else works and the open questions", async () => {
    const { repo, root, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
    const engine = await openSession(repo, { worktree: trees["engine"]!, agent: "kiro" }, new Date("2026-11-12T08:00:00Z"));
    const operator = await openSession(repo, { worktree: root, agent: "operator" }, new Date("2026-11-12T08:30:00Z"));
    await claimTask(repo, engine, await new Records(repo).readLedger(), "B2", "T9 store");
    await setProject(repo, operator, { purpose: "Replay market data." });
    await putEntry(repo, operator, { kind: "rule", title: "Never push main", text: "Pushing is the operator's.", section: "safety", source: "the operator, 2026-11-14" });
    await putEntry(repo, operator, { kind: "rule", title: "Old rule", text: "No longer.", section: "safety", source: "the operator, 2026-11-14" });
    await retireEntry(repo, operator, "rule-2", "lifted");
    await writeHandoff(repo, data, { task: "4 manifest", lines: ["RED is in"] });
    await addQuestion(repo, { group: "platform", question: "Lots?", meanwhile: "refused" });

    const brief = await sessionBrief(repo, data);

    expect(brief.project).toMatchObject({ purpose: "Replay market data." });
    expect(brief.rules.map((rule) => [rule.id, rule.text])).toEqual([["rule-1", "Pushing is the operator's."]]);
    expect(brief.track).toMatchObject({ name: "data", tasks: [{ milestone: "B2", id: "4 manifest" }, { milestone: "B2", id: "5 transcoder" }], handoff: { from: "claude", task: "4 manifest", lines: ["RED is in"] } });
    expect(brief.working).toEqual([{ track: "engine", agent: "kiro", since: "2026-11-12T08:00:00.000Z", task: "B2 / T9 store" }, { track: "main", agent: "operator", since: "2026-11-12T08:30:00.000Z" }]);
    expect(brief.openQuestions).toBe(1);
  });

  test("lists the id, kind and title of what applies to the track's paths and of what applies everywhere, the rules apart; a track with no paths works anywhere, so all of it applies", async () => {
    const tracked = await makeTracked();
    const repo = withPaths(tracked.repo, "data", ["packages/core"]);
    const data = await openSession(repo, { worktree: tracked.trees["data"]!, agent: "claude" });
    const engine = await openSession(repo, { worktree: tracked.trees["engine"]!, agent: "kiro" });
    await putEntry(repo, OPERATOR, { kind: "rule", title: "Never push main", text: "x", section: "safety", source: "the operator, 2026-11-14" });
    await putEntry(repo, DATA, { kind: "convention", title: "errors are TallyError", text: "x" });
    await putEntry(repo, DATA, { kind: "area", title: "the landing", text: "x", paths: ["packages/core/src/land/**"] });
    await putEntry(repo, DATA, { kind: "area", title: "the board", text: "x", paths: ["packages/web"] });
    await putEntry(repo, DATA, { kind: "howto", title: "run the tests", text: "x", paths: ["packages/*/tests"] });
    await putEntry(repo, DATA, { kind: "finding", title: "gone", text: "x", paths: ["packages/core"] });
    await retireEntry(repo, DATA, "finding-1", "fixed");

    const mine = await sessionBrief(repo, data);
    const theirs = await sessionBrief(repo, engine);

    expect(mine.entries).toEqual([{ id: "convention-1", kind: "convention", title: "errors are TallyError" }, { id: "area-1", kind: "area", title: "the landing" }, { id: "howto-1", kind: "howto", title: "run the tests" }]);
    expect(theirs.entries.map((entry) => entry.id)).toEqual(["convention-1", "area-1", "area-2", "howto-1"]);
    expect(mine.track.handoff).toBeNull();
  });

  test("says what a new repository's context still lacks, until its first session has filled it in", async () => {
    const git = await makeRepo();
    const started = await startRecords(git.root, { identity: { name: "service", email: "service@example.com" } });
    const operator = await openSession(started, { worktree: git.root, agent: "operator" });

    const first = await sessionBrief(started, operator);
    await setProject(started, operator, { purpose: "Replay market data." });
    await configureRepo(started, operator, { commands: { test: ["npm", "test"] } });
    await putEntry(started, operator, { kind: "area", title: "the store", text: "x" });
    await putEntry(started, operator, { kind: "howto", title: "run the tests", text: "x" });
    const partly = await sessionBrief(await openRepo(git.root), operator);
    await putEntry(started, operator, { kind: "rule", title: "Never push main", text: "x", section: "safety", source: "the operator, 2026-11-14" });
    const filled = await sessionBrief(await openRepo(git.root), operator);

    expect(first.missing).toEqual(["no project purpose", "no check is set", "no area", "no howto", "no rule"]);
    expect(first).toMatchObject({ project: { purpose: "" }, rules: [], track: { name: "main", tasks: [], handoff: null }, entries: [], working: [], openQuestions: 0 });
    expect(partly.missing).toEqual(["no rule"]);
    expect(filled.missing).toEqual([]);
  });

  test("carries each rule slim, in rulebook order, and tells an operator session which rules still wait, and no track session", async () => {
    const tracked = await makeTracked();
    const repo = keepingContextAsRecords(tracked.repo);
    const data = await openSession(repo, { worktree: tracked.trees["data"]!, agent: "claude" });
    const operator = await openSession(repo, { worktree: tracked.root, agent: "operator" });
    await putEntry(repo, OPERATOR, { kind: "rule", title: "Ours", text: "x", section: "working", source: "the operator, 2026-11-14" });
    await adoptRulebook(repo, OPERATOR);
    await tailorRule(repo, OPERATOR, { id: "rule-2", source: "the operator, 2026-11-14" });

    const mine = await sessionBrief(repo, data);
    const theirs = await sessionBrief(repo, operator);

    expect(mine.rules).toHaveLength(29 + 1);
    expect(mine.rules[0]).toEqual({ id: "rule-31", section: "authority", title: RULEBOOK[0]?.title, text: RULEBOOK[0]?.text });
    expect(Object.keys(mine.rules[1] ?? {})).toEqual(["id", "section", "title", "text"]);
    expect(mine.rules.map((rule) => rule.section).filter((section, index, all) => all.indexOf(section) === index)).toEqual(["authority", "safety", "working", "once"]);
    expect(mine).not.toHaveProperty("tailoring");
    expect(theirs.tailoring).toHaveLength(8);
    expect(theirs.tailoring?.[0]).toEqual({ id: "rule-3", title: RULEBOOK[1]?.title, tailor: RULEBOOK[1]?.tailor });
    expect(Object.keys(theirs.tailoring?.[0] ?? {})).toEqual(["id", "title", "tailor"]);
  });

  test("tells an operator session how many record files wait and since when, and no track session", async () => {
    const tracked = await makeTracked();
    const repo = keepingContextAsRecords(tracked.repo);
    const data = await openSession(repo, { worktree: tracked.trees["data"]!, agent: "claude" });
    const operator = await openSession(repo, { worktree: tracked.root, agent: "operator" });
    await putEntry(repo, OPERATOR, { kind: "rule", title: "Ours", text: "x", section: "working", source: "the operator, 2026-11-14" });

    const theirs = await sessionBrief(repo, operator);
    const mine = await sessionBrief(repo, data);

    expect(theirs.recordsWaiting?.files).toBeGreaterThan(0);
    expect(theirs.recordsWaiting).toHaveProperty("since");
    expect(mine).not.toHaveProperty("recordsWaiting");
  });

  test("leaves tailoring out of an operator's brief when no rule waits", async () => {
    const tracked = await makeTracked();
    const repo = keepingContextAsRecords(tracked.repo);
    const operator = await openSession(repo, { worktree: tracked.root, agent: "operator" });
    await putEntry(repo, OPERATOR, { kind: "rule", title: "Ours", text: "x", section: "working", source: "the operator, 2026-11-14" });

    expect(await sessionBrief(repo, operator)).not.toHaveProperty("tailoring");
  });

  test("a task carries who holds it, what it waits for, and its brief and paths when the ledger has them", () => {
    const ledger = { schema: 1, baseline: "abc1234", other: [], milestones: [{ id: "B2", stage: "B", name: "store", track: "data", weight: 1, tasks: [
      { id: "1 plain", track: "data", status: "planned", also: [] },
      { id: "2 told", track: "data", status: "planned", also: [], waits: "row 7", brief: "write the manifest", paths: ["src/store"] },
      { id: "3 landed", track: "data", status: "landed", commit: "abc1234", also: [] },
      { id: "4 theirs", track: "engine", status: "planned", also: [] },
      { id: "5 held", track: "data", status: "planned", also: [], waitsOn: [{ task: "B2:4 theirs", what: "its format" }] },
    ] }] } as unknown as Ledger;
    const claims = [{ milestone: "B2", task: "1 plain", track: "data", sessionId: "s", agent: "claude", since: "2026-11-12T08:00:00.000Z" }];

    expect(unlandedTasks(ledger, "data", claims)).toEqual([
      { milestone: "B2", id: "1 plain", claimedBy: "claude" },
      { milestone: "B2", id: "2 told", waits: "row 7", brief: "write the manifest", paths: ["src/store"] },
      { milestone: "B2", id: "5 held", waits: "B2:4 theirs (its format)" },
    ]);
  });
});
