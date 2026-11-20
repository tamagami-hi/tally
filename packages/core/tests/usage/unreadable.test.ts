import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { USAGE_FILE, Usage, readUsage } from "../../src/usage/counts.ts";
import { tmpDir } from "../support/tmp.ts";

const AT = new Date("2026-11-20T09:00:00.000Z");
const ASIDE = "usage.json.2026-11-20T09-00-00.000Z.unreadable";

function stderrLines(): string[] {
  const said: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    said.push(String(chunk));
    return true;
  });
  return said;
}

async function broken(text: string): Promise<string> {
  const path = join(await tmpDir("tally-usage-"), USAGE_FILE);
  await writeFile(path, text);
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a usage file that cannot be read", () => {
  test.each([["is not JSON", "{ not json"], ["does not fit", "{\"schema\": 1, \"tools\": 3}"]])("when it %s, is moved aside under a dated name, the count starts empty, and one line on stderr says so", async (_, text) => {
    const path = await broken(text);
    const said = stderrLines();

    const usage = await Usage.open(path, "0.7.0", AT);

    expect(usage.snapshot().tools).toEqual({});
    expect((await readdir(dirname(path))).sort()).toEqual([ASIDE]);
    expect(await readFile(join(dirname(path), ASIDE), "utf8")).toBe(text);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^tally could not read .*usage\.json .*; it was moved to .*\.unreadable, and the count starts empty\n$/);
    expect(said[0]?.split("\n")).toHaveLength(2);
  });

  test("is read as an empty count by a reader too, and counting goes on into a new file", async () => {
    const path = await broken("{ not json");
    stderrLines();

    expect((await readUsage(path, AT)).tools).toEqual({});
    const usage = await Usage.open(path, "0.7.0", AT);
    usage.count({ tool: "board_get", outcome: "answered", by: "none" }, AT);
    await usage.stop();

    expect((await readUsage(path, AT)).tools["board_get"]?.calls).toBe(1);
  });
});
