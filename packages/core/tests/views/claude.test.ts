import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { STANDING_END, STANDING_START, replaceStanding, standingBlock, standingNow, writeClaudeView } from "../../src/views/claude.ts";
import { Records } from "../../src/store/records.ts";
import { plan } from "../../src/ledger/ops.ts";
import { makeTracked } from "../support/tracked.ts";

const CLAUDE = `# CLAUDE.md

Read RULES.md first.

## Where the project stands

- **A0 is built** (the operator's prose stays).

${STANDING_START}
stale
${STANDING_END}

## Task map

| Task | Read |
`;

describe("the standing block", () => {
  test("is one table of the ledger's rows with the stages, the tracks and the open questions, and nothing time-dependent", () => {
    const block = standingBlock({
      stages: [{ id: "A", name: "the thin slice", weight: 32 }, { id: "B", name: "widen", weight: 68 }],
      stagePct: { A: 1, B: 0.385 },
      overall: 0.52,
      rows: [
        { id: "A0-A7", stage: "A", name: "the thin slice", track: "all", weight: 100, built: "aaa..bbb", tasks: [], share: 1, count: null, notes: ["built"] },
        { id: "B4", stage: "B", name: "simulator", track: "alpha+beta", weight: 14, tasks: [], share: 18 / 23, count: [18, 23], notes: ["beta next: T8 candle_close", "T9 store: waits for B2"] },
        { id: "B5", stage: "B", name: "full | builder", track: "beta", weight: 14, tasks: [], share: 0, count: null, notes: ["not started"] },
        { id: "C1", stage: "C", name: "candles", track: "-", weight: 34, waits: "candle files", tasks: [], share: 0, count: null, notes: ["waits for candle files"] },
      ],
      tracks: [{ name: "alpha", worktree: ".temp/worktrees/alpha", branch: "track/alpha" }],
      mainBranch: "main",
      questions: { rows: ["36 (engine)", "37 (engine)"], nextRow: 38 },
    });
    expect(block).toBe(`${STANDING_START}
**Where the ledger stands** (written whole by \`tally views claude\` from \`docs/records/\`; never edit between these markers): **52%** overall; stage A the thin slice 100%, stage B widen 39%.

| Stage | Milestone | Track | Where it stands |
| --- | --- | --- | --- |
| A | A0-A7 the thin slice | all | built |
| B | B4 simulator | alpha+beta | 18 of 23 tasks landed; beta next: T8 candle_close; T9 store: waits for B2 |
| B | B5 full \\| builder | beta | not started |
| C | C1 candles | - | waits for candle files |

Tracks: alpha (\`.temp/worktrees/alpha\`, \`track/alpha\`). Open questions: 36 (engine), 37 (engine); the next row is 38.
${STANDING_END}`);
    const alone = standingBlock({ stages: [], stagePct: {}, overall: 0, rows: [], tracks: [], mainBranch: "main", questions: { rows: [], nextRow: null } });
    expect(alone).toContain("| --- | --- | --- | --- |\n\nTracks: none, work lands on main. Open questions: none; the next row is unknown.");
  });

  test("replaces only what is between the markers, twice over, and refuses text without them", () => {
    const once = replaceStanding(CLAUDE, `${STANDING_START}\nfresh\n${STANDING_END}`);
    expect(once).toBe(CLAUDE.replace("stale", "fresh"));
    expect(replaceStanding(once, `${STANDING_START}\nfresh\n${STANDING_END}`)).toBe(once);
    expect(() => replaceStanding("# CLAUDE.md\n", "x")).toThrow(`no ${STANDING_START} … ${STANDING_END} markers; add them to CLAUDE.md where the standing block belongs`);
    expect(() => replaceStanding(`${STANDING_END}\n${STANDING_START}`, "x")).toThrow(/markers/);
  });

  test("writes the block into the repository's CLAUDE.md from the records, idempotently, and check never writes", async () => {
    const { repo, root } = await makeTracked();
    await expect(writeClaudeView(repo)).rejects.toThrow(/CLAUDE.md does not exist/);
    await writeFile(join(root, "CLAUDE.md"), CLAUDE);
    const first = await writeClaudeView(repo);
    expect(first).toEqual({ path: join(root, "CLAUDE.md"), changed: true });
    const written = await readFile(join(root, "CLAUDE.md"), "utf8");
    expect(written.startsWith("# CLAUDE.md\n\nRead RULES.md first.\n\n## Where the project stands\n\n- **A0 is built** (the operator's prose stays).\n\n")).toBe(true);
    expect(written.endsWith(`${STANDING_END}\n\n## Task map\n\n| Task | Read |\n`)).toBe(true);
    expect(written).toContain("| B | B2 store | data+engine | 0 of 4 tasks landed; data next: 4 manifest; T9 store: waits for B2 |");
    expect(written).toContain("Tracks: data (`.temp/worktrees/data`, `track/data`); engine (`.temp/worktrees/engine`, `track/engine`). Open questions: none; the next row is unknown.");
    expect(await writeClaudeView(repo)).toEqual({ path: join(root, "CLAUDE.md"), changed: false });
    await new Records(repo).update((ledger) => plan(ledger, { milestone: "B2", track: "data", tasks: ["6 transcoder"] }));
    expect(await writeClaudeView(repo, { check: true })).toEqual({ path: join(root, "CLAUDE.md"), changed: true });
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe(written);
    expect(await standingNow(repo)).toContain("0 of 5 tasks landed");
  });
});
