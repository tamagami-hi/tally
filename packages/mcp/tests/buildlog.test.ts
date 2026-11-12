import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

const section = { group: "data", milestone: "B2", title: "The replay store", date: "2026-11-05" };

async function serving() {
  const { repo, trees } = await makeTracked();
  const { call } = await connect(repo);
  return { call, sessionId: await opened(call, trees["data"]!) };
}

describe("the build log through the tools", () => {
  test("buildlog_append takes fields in place of Markdown, and buildlog_render shows them as a section", async () => {
    const { call, sessionId } = await serving();

    const appended = await call("buildlog_append", { sessionId, ...section, built: "the store", verified: [{ what: "the unit suite", check: "npm test", totals: { passed: 101, failed: 0 } }], open: ["the persisted store"] });
    const rendered = await call("buildlog_render", { group: "data" });

    expect(appended.isError).toBe(false);
    expect(appended.structured["entry"]).toEqual({ ...section, markdown: "", commits: [], built: "the store", verified: [{ what: "the unit suite", check: "npm test", totals: { passed: 101, failed: 0 } }], open: ["the persisted store"] });
    expect(rendered.text).toBe("# data: build log\n\n## B2. The replay store, 2026-11-05\n\n**Built:** the store\n\n**Verified:**\n- the unit suite: `npm test` (passed 101, failed 0)\n\n**Open:**\n- the persisted store\n");
  });

  test("buildlog_append with Markdown alone answers as it did, and with neither it is refused", async () => {
    const { call, sessionId } = await serving();

    const appended = await call("buildlog_append", { sessionId, ...section, markdown: "**Built:** the store.\n", commits: ["abc1234"] });
    const refused = await call("buildlog_append", { sessionId, ...section, milestone: "B3" });

    expect(appended.structured["entry"]).toEqual({ ...section, markdown: "**Built:** the store.", commits: ["abc1234"] });
    expect(Object.keys(appended.structured["entry"] as object)).toEqual(["group", "milestone", "title", "date", "markdown", "commits"]);
    expect(refused).toMatchObject({ isError: true, text: "a build log entry needs a body: its markdown, or one of built, verified, decided, corrected and open" });
  });
});
