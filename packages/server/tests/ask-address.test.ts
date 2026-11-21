import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { service } from "./support/service.ts";
import { REVISIONS, callerAt, namesAt, type Fetching } from "./support/revisions.ts";
import { Usage, USAGE_FILE } from "../../core/src/usage/counts.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { CANNOT_CARRY, NO_FORM } from "../../mcp/src/tools/ask-trial.ts";

const through = (app: Awaited<ReturnType<typeof service>>["app"]): Fetching => async (request) => app.request(request);

describe.each(REVISIONS)("the trial's address /mcp/ask on %s", (revision) => {
  test("lists ask_trial alone, which no other address lists, and counts nothing", async () => {
    const usage = await Usage.open(join(await tmpDir("tally-usage-"), USAGE_FILE), "0.9.3");
    const { app } = await service(usage);

    const listed = await namesAt(through(app), "/mcp/ask", revision);
    const answered = await callerAt(through(app), "/mcp/ask", revision)("ask_trial", { about: "Is the trial seen?" });
    const elsewhere = await Promise.all(["/mcp", "/mcp/builder", "/mcp/reviewer", "/r/alpha/mcp"].map((path) => namesAt(through(app), path, revision)));

    expect(listed).toEqual(["ask_trial"]);
    expect(answered.structured).toEqual({ asked: false, reason: revision === "2026-07-28" ? NO_FORM : CANNOT_CARRY });
    expect(elsewhere.some((names) => names.includes("ask_trial"))).toBe(false);
    expect(usage.snapshot().tools).toEqual({});
  });
});
