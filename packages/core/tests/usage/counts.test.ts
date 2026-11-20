import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { USAGE_FILE, Usage, usagePathOf, readUsage } from "../../src/usage/counts.ts";
import { tmpDir } from "../support/tmp.ts";

const DAY_ONE = new Date("2026-11-20T09:00:00.000Z");
const LATER_THAT_DAY = new Date("2026-11-20T18:00:00.000Z");
const DAY_TWO = new Date("2026-11-21T08:00:00.000Z");

async function fresh(version = "0.7.0"): Promise<{ usage: Usage; path: string }> {
  const path = join(await tmpDir("tally-usage-"), USAGE_FILE);
  const usage = await Usage.open(path, version, DAY_ONE);
  return { usage, path };
}

describe("a count of what is called", () => {
  it("counts a read, a write, a refusal, a cut answer and a call the schema refused, each for its tool", async () => {
    const { usage } = await fresh();

    usage.count({ tool: "board_get", outcome: "answered", by: "none", repo: "alpha" }, DAY_ONE);
    usage.count({ tool: "task_claim", outcome: "answered", by: "track", repo: "alpha" }, DAY_ONE);
    usage.count({ tool: "task_claim", outcome: "refused", by: "track", repo: "alpha" }, LATER_THAT_DAY);
    usage.count({ tool: "board_get", outcome: "cut", by: "operator", repo: "alpha" }, DAY_TWO);
    usage.count({ tool: "task_claim", outcome: "invalid", by: "none" }, DAY_TWO);

    const tools = usage.snapshot().tools;
    expect(tools["board_get"]).toMatchObject({ calls: 2, refused: 0, cut: 1, invalid: 0, first: DAY_ONE.toISOString(), last: DAY_TWO.toISOString(), days: 2, by: { none: 1, track: 0, operator: 1 } });
    expect(tools["task_claim"]).toMatchObject({ calls: 2, refused: 1, cut: 0, invalid: 1, days: 2, by: { track: 2, none: 0, operator: 0 } });
  });

  it("counts two repositories apart", async () => {
    const { usage } = await fresh();

    usage.count({ tool: "board_get", outcome: "answered", by: "none", repo: "alpha" }, DAY_ONE);
    usage.count({ tool: "board_get", outcome: "answered", by: "none", repo: "beta" }, DAY_ONE);
    usage.count({ tool: "board_get", outcome: "answered", by: "none", repo: "beta" }, DAY_ONE);

    expect(usage.snapshot().tools["board_get"]?.repos).toEqual({ alpha: 1, beta: 2 });
  });

  it("writes the file when flushed, and a server started again reads it back and adds its version", async () => {
    const { usage, path } = await fresh("0.7.0");
    usage.count({ tool: "board_get", outcome: "answered", by: "none", repo: "alpha" }, DAY_ONE);

    await usage.flush();
    const again = await Usage.open(path, "0.8.0", DAY_TWO);
    again.count({ tool: "board_get", outcome: "answered", by: "none", repo: "alpha" }, DAY_TWO);

    expect((await readUsage(path)).tools["board_get"]?.calls).toBe(1);
    expect(again.snapshot()).toMatchObject({ since: DAY_ONE.toISOString(), versions: [{ version: "0.7.0", since: DAY_ONE.toISOString() }, { version: "0.8.0", since: DAY_TWO.toISOString() }] });
    expect(again.snapshot().tools["board_get"]?.calls).toBe(2);
  });

  it("writes at most every 30 seconds while running, and once more when it stops", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { usage, path } = await fresh();
      usage.start();
      usage.count({ tool: "board_get", outcome: "answered", by: "none", repo: "alpha" }, DAY_ONE);
      expect(await readFile(path, "utf8").catch(() => "")).toBe("");

      await vi.advanceTimersByTimeAsync(29_000);
      expect(await readFile(path, "utf8").catch(() => "")).toBe("");
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(async () => expect((await readUsage(path)).tools["board_get"]?.calls).toBe(1));

      usage.count({ tool: "board_get", outcome: "answered", by: "none", repo: "alpha" }, DAY_ONE);
      await usage.stop();
      expect((await readUsage(path)).tools["board_get"]?.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the service's file in its home and a single repository's in its state folder", () => {
    expect(usagePathOf({ home: "/srv/tally" })).toBe("/srv/tally/usage.json");
    expect(usagePathOf({ stateDir: "/work/repo/.temp/tally/state" })).toBe("/work/repo/.temp/tally/state/usage.json");
  });
});
