import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { joinQueue, ticketView } from "../../src/land/queue.ts";
import { recordLanding } from "../../src/land/record.ts";
import { advance } from "../../src/land/turn.ts";
import type { Check } from "../../src/schema/config.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { commitOn } from "../support/landing.ts";
import { ready, runHead, type Queued } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

const noting = (name: string): string[] => ["sh", "-c", `echo "${name} $(git log -1 --format=%s)" >> "$RUNS"; exit 0`];

const CHECKS: Check[] = [{ name: "core", command: noting("core"), paths: ["src"] }, { name: "pages", command: noting("pages"), paths: ["web/**"] }];

async function checked(landing: Record<string, unknown> = {}): Promise<Queued & { repo: Repo }> {
  const q = await ready();
  const repo = { ...q.repo, config: { ...q.repo.config, commands: { ...q.repo.config.commands, checks: CHECKS, landing: { ...q.repo.config.commands.landing, ...landing } } } };
  await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
  await sh(q.root, ["add", "-A"]);
  await sh(q.root, ["commit", "-q", "-m", "records: plan"]);
  return { ...q, repo };
}

describe("checks chosen for each commit", () => {
  test("runs on each commit the checks whose paths match what that commit itself changes", async () => {
    const q = await checked();
    await commitOn(q.tree, "src/one.rs", "feat: one");
    await commitOn(q.tree, "web/app/page.tsx", "feat: two");
    const ticket = await joinQueue(q.repo, q.session, { files: [] });
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    expect((await ticketView(q.repo, ticket.id)).state).toBe("landed");
    expect(await q.runs()).toEqual(["core feat: one", "pages feat: two"]);
  });

  test("refuses, when the turn is prepared and before any check runs, a commit no check covers, naming it and its files", async () => {
    const q = await checked();
    await commitOn(q.tree, "src/one.rs", "feat: one");
    await commitOn(q.tree, "notes/plan.txt", "docs: a plan");
    const before = await q.main();
    const ticket = await joinQueue(q.repo, q.session, { files: [] });

    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toMatch(/^no check in commands\.checks covers what [0-9a-f]{7} \(docs: a plan\) changes: notes\/plan\.txt; add a check whose paths match them, however small, so that nothing lands unchecked/);
    expect(await q.runs()).toEqual([]);
    expect(await q.main()).toBe(before);
  });

  test("checks a merge's work by the commits the rebase leaves, each against its own first parent", async () => {
    const q = await checked();
    await commitOn(q.tree, "src/one.rs", "feat: one");
    await sh(q.tree, ["checkout", "-q", "-b", "side", "main"]);
    await commitOn(q.tree, "web/side.tsx", "feat: side");
    await sh(q.tree, ["checkout", "-q", "track/data"]);
    await sh(q.tree, ["merge", "-q", "--no-ff", "-m", "merge: side", "side"]);
    await joinQueue(q.repo, q.session, { files: [] });
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);

    expect(await q.runs()).toEqual(["core feat: one", "pages feat: side"]);
  });
});

describe("an empty commit", () => {
  test("is planned with no check, lands, and the log says it changes no file", async () => {
    const q = await checked();
    await commitOn(q.tree, "src/one.rs", "feat: one");
    await sh(q.tree, ["commit", "-q", "--allow-empty", "-m", "chore: nothing"]);
    const empty = (await sh(q.tree, ["rev-parse", "--short=7", "HEAD"])).trim();
    const ticket = await joinQueue(q.repo, q.session, { files: [] });
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    expect((await ticketView(q.repo, ticket.id)).state).toBe("landed");
    expect(await q.runs()).toEqual(["core feat: one"]);
    const logs = join(q.root, ".temp/tally/logs/data");
    const text = (await Promise.all((await readdir(logs)).map((name) => readFile(join(logs, name), "utf8")))).join("");
    expect(text).toMatch(new RegExp(`tally: [0-9a-f]{7} \\(chore: nothing\\) changes no file, so no check runs for it`));
    expect(empty).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe("a landing that checks its tip only", () => {
  test("checks the last commit alone with every check the landing's files choose, and its task records it", async () => {
    const q = await checked();
    await commitOn(q.tree, "src/one.rs", "feat: one");
    await commitOn(q.tree, "web/app/page.tsx", "feat: two");
    const ticket = await joinQueue(q.repo, q.session, { files: [], check: "tip", target: { milestone: "A1", task: "t1" } });
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    expect(await ticketView(q.repo, ticket.id)).toMatchObject({ state: "landed", check: "tip" });
    expect(await q.runs()).toEqual(["core feat: two", "pages feat: two"]);
    expect((await new Records(q.repo).readLedger()).milestones[0]?.tasks[0]).toMatchObject({ status: "landed", checked: "tip" });
  });

  test("is refused at land_start without a milestone and task, since the task's record is where the mark lasts", async () => {
    const q = await checked();
    await commitOn(q.tree, "src/one.rs", "feat: one");

    await expect(joinQueue(q.repo, q.session, { files: [], check: "tip" })).rejects.toThrow("a landing that checks its tip only is recorded on a task: give the landing its milestone and task");
  });

  test("names the mark in the line it gives when its task's record fails", async () => {
    const q = await checked();
    const head = await q.main();

    const recording = await recordLanding(q.repo, { track: "data", head, commits: [head] }, { milestone: "Z9", task: "x", checked: "tip" }, q.session);

    expect(recording.recorded).toBe(false);
    expect(recording.message).toMatch(/finish it with tally task land Z9 'x' [0-9a-f]+ --checked tip$/);
  });

  test("is refused at land_start where commands.landing.tip is never", async () => {
    const q = await checked({ tip: "never" });
    await commitOn(q.tree, "src/one.rs", "feat: one");

    await expect(joinQueue(q.repo, q.session, { files: [], check: "tip" })).rejects.toThrow("this repository checks each commit alone (commands.landing.tip is never), so a landing cannot ask to check its tip only");
  });
});
