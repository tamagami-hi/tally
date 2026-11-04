import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { run } from "../src/run.ts";
import type { IO } from "../src/io.ts";
import { edit, landingFixture } from "../../core/tests/support/landing.ts";

interface Console extends IO {
  lines: string[];
  errors: string[];
}

function terminal(cwd: string): Console {
  const console: Console = { lines: [], errors: [], out: (line) => console.lines.push(line), err: (line) => console.errors.push(line), cwd, env: {}, columns: 120, isTTY: false };
  return console;
}

const quiet = async <T>(body: () => Promise<T>): Promise<T> => {
  const written = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    return await body();
  } finally {
    written.mockRestore();
  }
};

describe("tally land with commands.landing", () => {
  test("a failing commit exits 1 and names the commit and a log holding its output", async () => {
    const f = await landingFixture("echo broken; exit 1");
    await edit(f.tree, "src/new.rs");
    const console = terminal(f.root);

    const exit = await quiet(() => run(["land", "data", "--message", ".temp/message.txt", "src/new.rs"], console));

    const log = /the log is (\S+?);/.exec(console.errors[0] ?? "")?.[1];
    expect(exit).toBe(1);
    expect(console.errors[0]).toContain("feat(data): the task failed:");
    expect(log?.startsWith(join(f.tree, ".temp", "data", "tally", "landings"))).toBe(true);
    expect(await readFile(log!, "utf8")).toContain("broken\n");
  });

  test("says which commit it is testing, and lands", async () => {
    const f = await landingFixture("true");
    await edit(f.tree, "src/new.rs");
    const console = terminal(f.root);

    expect(await quiet(() => run(["land", "data", "--message", ".temp/message.txt", "src/new.rs"], console))).toBe(0);

    const head = (await f.main()).slice(0, 7);
    expect(console.lines).toEqual([`testing ${head} feat(data): the task (1 of 1)`, `data landed at ${head}`]);
  });
});

describe("tally land without commands.landing", () => {
  test("keeps no log: the output goes to the terminal alone", async () => {
    const f = await landingFixture("true", null);
    await edit(f.tree, "src/new.rs");
    const console = terminal(f.root);

    expect(await quiet(() => run(["land", "data", "--message", ".temp/message.txt", "src/new.rs"], console))).toBe(0);

    expect(console.lines).toEqual([`data landed at ${(await f.main()).slice(0, 7)}`]);
    await expect(lstat(join(f.tree, ".temp", "data", "tally"))).rejects.toThrow("ENOENT");
  });
});
