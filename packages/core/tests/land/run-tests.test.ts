import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { landingLog, loggedTests, spawnTests } from "../../src/land/run-tests.ts";
import { tmpDir } from "../support/tmp.ts";

const SAY = ["sh", "-c", "echo out; echo err >&2"];
const FAIL = ["sh", "-c", "echo broken; exit 3"];

describe("the landing's log", () => {
  test("lies under the track's folder in the worktree, named by the time", () => {
    const log = landingLog("/repo/tree", "data", new Date("2026-11-04T10:20:30.400Z"));

    expect(log).toBe(join("/repo/tree", ".temp", "data", "tally", "landings", "2026-11-04T10-20-30-400Z.log"));
  });

  test("keeps both streams of every run, each under its label, so a run does not wipe the one before", async () => {
    const dir = await tmpDir();
    const log = join(dir, "landings", "a.log");
    const run = loggedTests(log);

    await run(dir, SAY, process.env, "abc1234 first");
    await run(dir, SAY, process.env, "def5678 second");

    const lines = (await readFile(log, "utf8")).split("\n");
    expect(lines.filter((line) => line.startsWith("== "))).toEqual(["== abc1234 first", "== def5678 second"]);
    expect(lines.filter((line) => line === "out")).toHaveLength(2);
    expect(lines.filter((line) => line === "err")).toHaveLength(2);
  });

  test("writes no label line for a run that has none", async () => {
    const dir = await tmpDir();
    const log = join(dir, "a.log");

    await loggedTests(log)(dir, ["echo", "out"], process.env);

    expect(await readFile(log, "utf8")).toBe("out\n");
  });

  test("a failed run says where it ran and where its log is, and its output is there", async () => {
    const dir = await tmpDir();
    const log = join(dir, "a.log");

    await expect(loggedTests(log)(dir, FAIL, process.env)).rejects.toThrow(`sh -c echo broken; exit 3 failed in ${dir}; the log is ${log}`);

    expect(await readFile(log, "utf8")).toBe("broken\n");
  });

  test("echoes to the terminal only when asked", async () => {
    const dir = await tmpDir();
    const written = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await loggedTests(join(dir, "quiet.log"))(dir, ["echo", "quiet"], process.env);
    await loggedTests(join(dir, "loud.log"), true)(dir, ["echo", "loud"], process.env);
    const seen = written.mock.calls.map(([chunk]) => String(chunk)).join("");
    written.mockRestore();

    expect(seen).not.toContain("quiet");
    expect(seen).toContain("loud");
    expect(await readFile(join(dir, "loud.log"), "utf8")).toBe("loud\n");
  });
});

describe("the plain test run", () => {
  test("fails by naming the command and the folder", async () => {
    const dir = await tmpDir();
    const written = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(spawnTests(dir, FAIL, process.env)).rejects.toThrow(`sh -c echo broken; exit 3 failed in ${dir}`);
    written.mockRestore();
  });

  test("refuses an empty command", async () => {
    await expect(spawnTests("/", [], process.env)).rejects.toThrow("the config names no test command");
  });
});
