import { describe, expect, test } from "vitest";
import { sessionBrief } from "../../src/context/brief.ts";
import { putEntry, retireEntry } from "../../src/context/entries.ts";
import { setProject } from "../../src/context/project.ts";
import { tailorRule } from "../../src/context/rulebook.ts";
import { writeHandoff } from "../../src/records/handoffs.ts";
import { openSession } from "../../src/state/sessions.ts";
import { OPERATOR } from "../support/context.ts";
import { makeTracked } from "../support/tracked.ts";

const T1 = new Date("2026-11-14T09:00:00.000Z");
const T2 = new Date("2026-11-14T10:00:00.000Z");
const T3 = new Date("2026-11-14T11:00:00.000Z");
const T4 = new Date("2026-11-14T12:00:00.000Z");

async function briefed() {
  const { repo, root, trees } = await makeTracked();
  const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
  const operator = await openSession(repo, { worktree: root, agent: "operator" });
  await setProject(repo, operator, { purpose: "Replay market data.", stack: ["rust"] });
  await putEntry(repo, OPERATOR, { kind: "rule", title: "Never push main", text: "Pushing is the operator's.", section: "safety", source: "the operator, 2026-11-14" }, T1);
  await putEntry(repo, OPERATOR, { kind: "convention", title: "Errors carry the file", text: "Name the path." }, T1);
  await writeHandoff(repo, data, { task: "4 manifest", lines: ["RED is in"] });
  return { repo, data, operator };
}

const keys = (value: object): string[] => Object.keys(value).sort();

describe("the brief's levels", () => {
  test("full holds everything, as before, and names its level and the rulebook's count and time", async () => {
    const { repo, data } = await briefed();

    const brief = await sessionBrief(repo, data, "full");

    expect(keys(brief)).toEqual(["entries", "level", "missing", "openQuestions", "project", "rulebook", "rules", "track", "working"]);
    expect(brief.level).toBe("full");
    expect(brief.rules).toEqual([{ id: "rule-1", section: "safety", title: "Never push main", text: "Pushing is the operator's." }]);
    expect(brief.rulebook).toEqual({ rules: 1, changedAt: T1.toISOString() });
  });

  test("work leaves out the rules' text and the project but its name and purpose, and keeps the hand-off and the open questions", async () => {
    const { repo, data } = await briefed();

    const brief = await sessionBrief(repo, data, "work");

    expect(keys(brief)).toEqual(["entries", "level", "openQuestions", "project", "rulebook", "rules", "track", "working"]);
    expect(brief.project).toEqual({ name: "Test", purpose: "Replay market data." });
    expect(brief.rules).toEqual([{ id: "rule-1", section: "safety", title: "Never push main" }]);
    expect(brief.track?.handoff).toMatchObject({ lines: ["RED is in"] });
  });

  test("land keeps the tasks by milestone, id, claim and wait, who works and the rulebook, and nothing else", async () => {
    const { repo, data } = await briefed();

    const brief = await sessionBrief(repo, data, "land");

    expect(keys(brief)).toEqual(["level", "rulebook", "track", "working"]);
    expect(keys(brief.track ?? {})).toEqual(["name", "tasks"]);
    expect(brief.track?.tasks[0]).toEqual({ milestone: "B2", id: "4 manifest" });
  });

  test("keeps the records waiting and the checkout for an operator at every level, and the rules to tailor at full only", async () => {
    const { repo, operator } = await briefed();

    const [full, work, land] = await Promise.all((["full", "work", "land"] as const).map((level) => sessionBrief(repo, operator, level)));

    for (const brief of [full, work, land]) expect(brief).toHaveProperty("recordsWaiting");
    for (const brief of [full, work, land]) expect(brief).toHaveProperty("checkout");
    expect(work).not.toHaveProperty("tailoring");
    expect(land).not.toHaveProperty("tailoring");
  });

  test("full is the level when none is asked for", async () => {
    const { repo, data } = await briefed();

    expect((await sessionBrief(repo, data)).level).toBe("full");
  });
});

describe("the rulebook's time", () => {
  test("moves when a rule is added, tailored or retired", async () => {
    const { repo, data } = await briefed();
    const changed = async (): Promise<string | null> => (await sessionBrief(repo, data, "land")).rulebook.changedAt;

    await putEntry(repo, OPERATOR, { kind: "rule", title: "Small files", text: "Under 400 lines.", section: "working", source: "the operator, 2026-11-14" }, T2);
    const added = await changed();
    await tailorRule(repo, OPERATOR, { id: "rule-2", source: "the operator, 2026-11-14", text: "Under 300 lines." }, T3);
    const tailored = await changed();
    await retireEntry(repo, OPERATOR, "rule-1", "lifted", T4);

    expect([added, tailored, await changed()]).toEqual([T2.toISOString(), T3.toISOString(), T4.toISOString()]);
  });
});
