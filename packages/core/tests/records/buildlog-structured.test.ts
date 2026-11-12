import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { appendBuildlog, importBuildlog, readBuildlog, renderBuildlog } from "../../src/records/buildlog.ts";
import { makeTracked } from "../support/tracked.ts";
import { LOG } from "../fixtures/records.ts";

const section = { group: "data", milestone: "B2", title: "The replay store", date: "2026-11-05" };

describe("structured build log entries", () => {
  test("append takes fields in place of Markdown, keeps them on the entry, and renders them as a short section", async () => {
    const { repo } = await makeTracked();
    const verified = [{ what: "the unit suite", check: "npm test", totals: { passed: 101, failed: 0 } }, { what: "the types", check: "npm run typecheck" }];

    const { entry } = await appendBuildlog(repo, { ...section, commits: ["abc1234"], built: " the store keys columns by id\n", verified, decided: ["keys are ids"], corrected: ["the lock path"], open: ["the persisted store"] });

    expect(entry).toEqual({ ...section, markdown: "", commits: ["abc1234"], built: "the store keys columns by id", verified, decided: ["keys are ids"], corrected: ["the lock path"], open: ["the persisted store"] });
    expect((await readBuildlog(repo)).entries).toEqual([entry]);
    expect(renderBuildlog(await readBuildlog(repo), "data")).toBe([
      "# data: build log",
      "",
      "## B2. The replay store, 2026-11-05",
      "",
      "**Built:** the store keys columns by id",
      "",
      "**Verified:**",
      "- the unit suite: `npm test` (passed 101, failed 0)",
      "- the types: `npm run typecheck`",
      "",
      "**Decided:**",
      "- keys are ids",
      "",
      "**Corrected:**",
      "- the lock path",
      "",
      "**Open:**",
      "- the persisted store",
      "",
    ].join("\n"));
  });

  test("an entry may carry Markdown and fields, and only the fields that say something are kept and rendered", async () => {
    const { repo } = await makeTracked();

    const { entry } = await appendBuildlog(repo, { ...section, markdown: "Notes on the store.\n", built: "  ", decided: ["keys are ids", " "], open: [] });

    expect(entry).toEqual({ ...section, markdown: "Notes on the store.", commits: [], decided: ["keys are ids"] });
    expect(renderBuildlog(await readBuildlog(repo), "data")).toBe("# data: build log\n\n## B2. The replay store, 2026-11-05\n\nNotes on the store.\n\n**Decided:**\n- keys are ids\n");
  });

  test("an entry with neither Markdown nor a field that says something is refused, as is a verified item with no check", async () => {
    const { repo } = await makeTracked();

    await expect(appendBuildlog(repo, section)).rejects.toThrow("a build log entry needs a body: its markdown, or one of built, verified, decided, corrected and open");
    await expect(appendBuildlog(repo, { ...section, markdown: "\n", decided: [" "], verified: [] })).rejects.toThrow(/needs a body/);
    await expect(appendBuildlog(repo, { ...section, verified: [{ what: "the unit suite", check: " " }] })).rejects.toThrow("a verified item needs what was verified and the check that showed it");
    expect((await readBuildlog(repo)).entries).toEqual([]);
  });

  test("sections kept as Markdown render exactly as they did beside a structured one", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(root, "log.md"), LOG);
    await importBuildlog(repo, join(root, "log.md"), "market_data");

    await appendBuildlog(repo, { ...section, group: "market_data", built: "the store" });
    await appendBuildlog(repo, { ...section, group: "market_data", milestone: "B3", title: "The clock", markdown: "**Built:** the clock." });

    expect(renderBuildlog(await readBuildlog(repo), "market_data")).toBe(`${LOG}\n## B2. The replay store, 2026-11-05\n\n**Built:** the store\n\n## B3. The clock, 2026-11-05\n\n**Built:** the clock.\n`);
    expect((await readBuildlog(repo)).entries.filter((entry) => entry.milestone !== "B2").every((entry) => Object.keys(entry).join() === "group,milestone,title,date,markdown,commits")).toBe(true);
  });
});
