import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { appendBuildlog, importBuildlog, parseBuildlog, readBuildlog, renderBuildlog } from "../../src/records/buildlog.ts";
import { makeTracked } from "../support/tracked.ts";
import { LOG } from "../fixtures/records.ts";

describe("build logs as records", () => {
  test("parses the preamble and each dated section, and renders the group back byte for byte", () => {
    const parsed = parseBuildlog(LOG, "market_data");
    expect(parsed.preamble).toBe("# The market data library: build log\n\n**What was built, verified, decided and corrected**, newest last.");
    expect(parsed.entries.map((e) => [e.milestone, e.title, e.date])).toEqual([
      ["A1", "The archive reader, index chains", "2026-10-30"],
      ["A1a", "The review's corrections", "2026-10-30"],
      ["B4 (data's part)", "The view, clock and derived bars", "2026-11-03"],
    ]);
    expect(parsed.entries[0]?.markdown).toBe("**Built:** `acme-core::archive` reads the index chain files.\n\n- **Verified:** 101 tests pass.\n- **Decided:** the one timestamp rule.");
    expect(renderBuildlog({ schema: 1, preambles: [{ group: "market_data", markdown: parsed.preamble }], entries: parsed.entries }, "market_data")).toBe(LOG);
  });

  test("import refuses a heading it cannot read and a lossy read, then keeps every group apart", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(root, "bad.md"), LOG.replace("## A1a. The review's corrections, 2026-10-30", "## A1a: corrections"));
    await expect(importBuildlog(repo, join(root, "bad.md"), "market_data")).rejects.toThrow(/line 12: '## A1a: corrections' is not '## <milestone>. <title>, <YYYY-MM-DD>'/);
    await writeFile(join(root, "lossy.md"), LOG.replace("\n## A1a.", "\n\n## A1a."));
    await expect(importBuildlog(repo, join(root, "lossy.md"), "market_data")).rejects.toThrow(/does not render back as it is/);
    await writeFile(join(root, "log.md"), LOG);
    expect(await importBuildlog(repo, join(root, "log.md"), "market_data")).toMatchObject({ entries: 3, commit: null });
    await writeFile(join(root, "engine.md"), "# The engine: build log\n\n## A4. The simulator, 2026-10-31\n\nMinimal.\n");
    await importBuildlog(repo, join(root, "engine.md"), "engine");
    await importBuildlog(repo, join(root, "log.md"), "market_data");
    const file = await readBuildlog(repo);
    expect(file.entries.map((e) => `${e.group}:${e.milestone}`)).toEqual(["engine:A4", "market_data:A1", "market_data:A1a", "market_data:B4 (data's part)"]);
    expect(renderBuildlog(file, "market_data")).toBe(LOG);
    expect(renderBuildlog(file, "engine")).toBe("# The engine: build log\n\n## A4. The simulator, 2026-10-31\n\nMinimal.\n");
    expect(() => renderBuildlog(file, "platform")).toThrow("no build log for group 'platform'; known: engine, market_data");
  });

  test("append adds a dated section the render then shows, and refuses a repeat, a bad date or an empty body", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(root, "log.md"), LOG);
    await importBuildlog(repo, join(root, "log.md"), "market_data");
    const { entry } = await appendBuildlog(repo, { group: "market_data", milestone: "B2", title: "The replay store", date: "2026-11-05", markdown: "**Built:** the store.\n", commits: ["abc1234"] });
    expect(entry).toMatchObject({ milestone: "B2", markdown: "**Built:** the store.", commits: ["abc1234"] });
    expect(renderBuildlog(await readBuildlog(repo), "market_data")).toBe(`${LOG}\n## B2. The replay store, 2026-11-05\n\n**Built:** the store.\n`);
    await expect(appendBuildlog(repo, { group: "market_data", milestone: "B2", title: "again", date: "2026-11-05", markdown: "x" })).rejects.toThrow("market_data's build log already has a section for B2");
    await expect(appendBuildlog(repo, { group: "market_data", milestone: "B5", title: "x", date: "5 Nov", markdown: "x" })).rejects.toThrow(/date must be YYYY-MM-DD/);
    await expect(appendBuildlog(repo, { group: "market_data", milestone: "B5", title: "x", date: "2026-11-05", markdown: " \n" })).rejects.toThrow(/needs a body/);
    const fresh = await appendBuildlog(repo, { group: "strategies", milestone: "S1", title: "The first strategy", date: "2026-11-06", markdown: "Built." });
    expect(fresh.entry.group).toBe("strategies");
    expect(renderBuildlog(await readBuildlog(repo), "strategies")).toBe("# strategies: build log\n\n## S1. The first strategy, 2026-11-06\n\nBuilt.\n");
  });
});
