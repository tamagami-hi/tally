import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import { checkPort, serveForCheck } from "./support/check-serve.ts";

const PORT = process.env["CHECK_PORT"];
const SECONDS = Number(process.env["CHECK_SECONDS"] ?? "600");
const OUT = process.env["CHECK_OUT"] ?? "/dev/null";
const MS_PER_SECOND = 1000;
const MARGIN_MS = 30_000;

describe.skipIf(PORT === undefined)("the planner's check with a real client and a browser", () => {
  test("serves the service app, its pages included, with two scratch repositories, and logs each MCP request", async () => {
    const checking = await serveForCheck(checkPort(PORT ?? ""), OUT);
    process.stdout.write(`the check serves ${checking.url} for ${SECONDS} s, logging MCP requests to ${OUT}\n`);

    await delay(SECONDS * MS_PER_SECOND);
    await checking.close();

    expect(checking.url).toContain("127.0.0.1");
  }, SECONDS * MS_PER_SECOND + MARGIN_MS);
});
