import { describe, expect, test } from "vitest";
import { run } from "../src/run.ts";
import type { IO } from "../src/io.ts";
import { readRepoList } from "../../core/src/repos/list.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

function io(cwd: string, home: string): Captured {
  const captured: Captured = {
    lines: [],
    errors: [],
    out: (line) => captured.lines.push(line),
    err: (line) => captured.errors.push(line),
    cwd,
    env: { TALLY_HOME: home },
    columns: 120,
    isTTY: false,
  };
  return captured;
}

async function elsewhere(): Promise<{ home: string; cwd: string }> {
  return { home: await tmpDir("tally-home-"), cwd: await tmpDir("tally-cwd-") };
}

describe("tally repo", () => {
  test("add lists a repository under a name, from any folder", async () => {
    const { home, cwd } = await elsewhere();
    const { root } = await makeTracked();
    const out = io(cwd, home);

    const exit = await run(["repo", "add", root, "--name", "alpha"], out);

    expect(exit).toBe(0);
    expect(out.lines).toEqual([`added alpha: ${root}`]);
    expect((await readRepoList(home)).repos.map((repo) => repo.name)).toEqual(["alpha"]);
  });

  test("add takes a path relative to the current folder", async () => {
    const { home } = await elsewhere();
    const { root } = await makeTracked();
    const out = io(root, home);

    await run(["repo", "add", ".", "--name", "alpha"], out);

    expect(out.lines).toEqual([`added alpha: ${root}`]);
  });

  test("add says why a folder is refused, and exits 1", async () => {
    const { home, cwd } = await elsewhere();
    const out = io(cwd, home);

    const exit = await run(["repo", "add", cwd, "--name", "alpha"], out);

    expect(exit).toBe(1);
    expect(out.errors).toEqual([`${cwd} is not a git repository`]);
  });

  test("list prints each repository and marks the default", async () => {
    const { home, cwd } = await elsewhere();
    const first = await makeTracked();
    const second = await makeTracked();
    await run(["repo", "add", first.root, "--name", "alpha"], io(cwd, home));
    await run(["repo", "add", second.root, "--name", "beta"], io(cwd, home));
    const out = io(cwd, home);

    await run(["repo", "list"], out);

    expect(out.lines).toEqual([`alpha  ${first.root}  (default)`, `beta  ${second.root}`]);
  });

  test("list says so when nothing is listed", async () => {
    const { home, cwd } = await elsewhere();
    const out = io(cwd, home);

    await run(["repo", "list"], out);

    expect(out.lines).toEqual(["no repository is listed"]);
  });

  test("default picks the repository a call that names none goes to", async () => {
    const { home, cwd } = await elsewhere();
    const first = await makeTracked();
    const second = await makeTracked();
    await run(["repo", "add", first.root, "--name", "alpha"], io(cwd, home));
    await run(["repo", "add", second.root, "--name", "beta"], io(cwd, home));
    const out = io(cwd, home);

    await run(["repo", "default", "beta"], out);

    expect(out.lines).toEqual(["the default repository is beta"]);
    expect((await readRepoList(home)).default).toBe("beta");
  });

  test("remove takes a repository off the list and says what it left", async () => {
    const { home, cwd } = await elsewhere();
    const { root } = await makeTracked();
    await run(["repo", "add", root, "--name", "alpha"], io(cwd, home));
    const out = io(cwd, home);

    await run(["repo", "remove", "alpha"], out);

    expect(out.lines).toEqual(["removed alpha; its records and its state are left as they are"]);
    expect((await readRepoList(home)).repos).toEqual([]);
  });

  test("an unknown verb is refused with the verbs it has", async () => {
    const { home, cwd } = await elsewhere();
    const out = io(cwd, home);

    const exit = await run(["repo", "rename", "alpha"], out);

    expect(exit).toBe(2);
    expect(out.errors).toEqual(["tally repo: unknown verb 'rename'; use add, remove, default or list"]);
  });

  test("help prints its line of the usage", async () => {
    const { home, cwd } = await elsewhere();
    const out = io(cwd, home);

    await run(["repo", "--help"], out);

    expect(out.lines.join("\n")).toContain("tally repo   add PATH [--name NAME]");
  });
});

describe("a command on a listed repository", () => {
  test("uses the state the server uses for it", async () => {
    const { home, cwd } = await elsewhere();
    const { root } = await makeTracked({ commit: true });
    await run(["repo", "add", root, "--name", "alpha"], io(cwd, home));
    const out = io(root, home);

    const exit = await run(["records", "commit"], out);

    expect(exit).toBe(0);
    const { stat } = await import("node:fs/promises");
    await expect(stat(`${home}/state/alpha/locks`)).resolves.toBeDefined();
    await expect(stat(`${root}/.temp/tally/state`)).rejects.toThrow();
  });
});
