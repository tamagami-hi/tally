import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { sessionBrief } from "../../src/context/brief.ts";
import { cycleDir } from "../../src/cycles/file.ts";
import { decisionsToMark } from "../../src/records/cited.ts";
import { addDecision, decisionsPath } from "../../src/records/decisions.ts";
import { cycling } from "../support/cycling.ts";

const BROKEN = "{ not json";

describe("decisionsToMark and an operator's brief with a file that does not parse", () => {
  test("decisionsToMark answers none and names an unreadable decisions file as a problem", async () => {
    const { repo } = await cycling();
    await writeFile(decisionsPath(repo), BROKEN);

    const marked = await decisionsToMark(repo);

    expect(marked.toMark).toEqual([]);
    expect(marked.problems).toEqual([expect.stringContaining("decisions.json")]);
  });

  test("decisionsToMark names an unreadable closed cycle's ledger, and reads the rest", async () => {
    const { repo } = await cycling();
    await addDecision(repo, { id: "DEC-7", group: "core", text: "to build", since: "2026-11-20", status: "decided, not built" }, { operator: true });
    await mkdir(cycleDir(repo.recordsDir, 1), { recursive: true });
    await writeFile(join(cycleDir(repo.recordsDir, 1), "ledger.json"), BROKEN);
    await writeFile(join(repo.recordsDir, "cycles.json"), JSON.stringify({ schema: 1, current: 2, cycles: [{ n: 1, from: "aaaaaaa", to: "bbbbbbb", closedAt: "2026-11-20T10:00:00.000Z", closedBy: { track: "main", agent: "operator" }, said: "close", summary: "the first" }] }));

    const marked = await decisionsToMark(repo);

    expect(marked.problems).toEqual([expect.stringContaining(join("cycle-1", "ledger.json"))]);
  });

  test("an operator's brief goes on, naming the unreadable decisions file among its problems", async () => {
    const { repo, operator } = await cycling();
    await writeFile(decisionsPath(repo), BROKEN);

    const brief = await sessionBrief(repo, operator, "work");

    expect(brief.decisions).toEqual({ unconfirmed: 0, disputed: [] });
    expect("problems" in brief ? brief.problems : []).toEqual([expect.stringContaining("decisions.json")]);
  });
});
