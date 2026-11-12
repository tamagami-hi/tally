import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { joinQueue, ticketView } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import type { Check } from "../../src/schema/config.ts";
import type { Repo } from "../../src/store/records.ts";
import { commitOn, edit } from "../support/landing.ts";
import { landing, ready, runHead, type Queued } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

const noting = (name: string, exit = 0): string[] => ["sh", "-c", `echo "${name} $(git log -1 --format=%s)" >> "$RUNS"; echo "${name} ran"; exit ${exit}`];

async function checked(checks: Check[]): Promise<Queued & { repo: Repo }> {
  const q = await ready();
  return { ...q, repo: { ...q.repo, config: { ...q.repo.config, commands: { ...q.repo.config.commands, checks } } } };
}

const logOf = (q: Queued, ticket: string): Promise<string> => readFile(join(q.root, ".temp/tally/logs/data", `land-${ticket}-1.log`), "utf8");

describe("a landing in a repository that lists checks by path", () => {
  test("runs, for each commit, the checks whose paths match what the landing changes, and not the rest", async () => {
    const q = await checked([
      { name: "core", command: noting("core"), paths: ["src"] },
      { name: "pages", command: noting("pages"), paths: ["web/**"] },
      { name: "docs", command: noting("docs"), paths: ["**/*.md"] },
    ]);
    await commitOn(q.tree, "src/one.rs", "feat: one");
    await commitOn(q.tree, "web/app/page.tsx", "feat: two");
    const ticket = await joinQueue(q.repo, q.session, { files: [] });
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    expect((await ticketView(q.repo, ticket.id)).state).toBe("landed");
    expect(await q.runs()).toEqual(["core feat: one", "pages feat: one", "core feat: two", "pages feat: two"]);
  });

  test("names each check in the log as it starts, under the commit it runs on", async () => {
    const q = await checked([{ name: "lint", command: noting("lint"), paths: ["src"] }, { name: "unit tests", command: noting("unit"), paths: ["src"] }]);
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);

    await runHead(q.repo);

    const lines = (await logOf(q, ticket.id)).split("\n").filter((line) => line !== "");
    expect(lines).toEqual([expect.stringMatching(/^== [0-9a-f]{7} feat\(data\): the task$/), "-- check lint", "lint ran", "-- check unit tests", "unit ran"]);
  });

  test("stops a commit at its first failing check, and the result still gives the commit one exit", async () => {
    const q = await checked([{ name: "lint", command: noting("lint", 3), paths: ["src"] }, { name: "unit", command: noting("unit"), paths: ["src"] }]);
    await edit(q.tree, "src/a.rs");
    const before = await q.main();
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(3);
    const result = await readFile(join(q.tree, ".temp/tally/landing", `${ticket.id}-1`, "commits"), "utf8");
    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toMatch(/failed its checks \(exit 3\); the log is .*land-.*\.log/);
    expect(result).toMatch(/^[0-9a-f]{40} 3\n$/);
    expect(await q.runs()).toEqual(["lint feat(data): the task"]);
    expect(await logOf(q, ticket.id)).not.toContain("-- check unit");
    expect(await q.main()).toBe(before);
  });

  test("fails the turn when no check covers what the landing changes, and names the files", async () => {
    const q = await checked([{ name: "pages", command: noting("pages"), paths: ["web"] }]);
    await edit(q.tree, "src/a.rs");
    await edit(q.tree, "src/b.rs");
    const before = await q.main();
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs", "src/b.rs"]));

    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toMatch(/^no check in commands\.checks covers what this landing changes: src\/a\.rs, src\/b\.rs; add a check whose paths match them, so that nothing lands unchecked; [0-9a-f]{7} is undone, and its files stay staged$/);
    expect(await q.main()).toBe(before);
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("A  src/a.rs\nA  src/b.rs");
  });

  test("counts a file a commit removed or renamed away, since a check of its folder covers that too", async () => {
    const q = await checked([{ name: "core", command: noting("core"), paths: ["src"] }, { name: "pages", command: noting("pages"), paths: ["web"] }]);
    await mkdir(join(q.tree, "web"));
    await sh(q.tree, ["mv", "src/lib.rs", "web/lib.rs"]);
    await sh(q.tree, ["commit", "-q", "-m", "refactor: move lib"]);
    await joinQueue(q.repo, q.session, { files: [] });
    await advance(q.repo);

    await runHead(q.repo);

    expect(await q.runs()).toEqual(["core refactor: move lib", "pages refactor: move lib"]);
  });
});

describe("a landing in a repository that lists no checks", () => {
  test("runs the test command as before, with nothing added to the log, when the list is absent or empty", async () => {
    for (const q of [await ready(), await checked([])]) {
      await edit(q.tree, "src/a.rs");
      const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
      await advance(q.repo);

      expect(await runHead(q.repo)).toBe(0);
      await advance(q.repo);

      expect((await ticketView(q.repo, ticket.id)).state).toBe("landed");
      expect(await q.runs()).toEqual([expect.stringMatching(/^[0-9a-f]{40} feat\(data\): the task$/)]);
      expect(await logOf(q, ticket.id)).toMatch(/^== [0-9a-f]{7} feat\(data\): the task\n$/);
    }
  });
});
