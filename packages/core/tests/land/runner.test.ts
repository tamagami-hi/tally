import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { LOGS, RESULTS, RUNNER, writeRunner } from "../../src/land/runner.ts";
import { sh } from "../support/repo.ts";
import { makeTracked, type Tracked } from "../support/tracked.ts";

interface Ran {
  exit: number;
  output: string;
}

function run(tree: string, args: readonly string[]): Promise<Ran> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, (error, stdout, stderr) => {
      const exit = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      done({ exit, output: `${String(stdout)}${String(stderr)}` });
    });
  });
}

async function ready(env: Record<string, string> = {}): Promise<Tracked & { tree: string }> {
  const tracked = await makeTracked();
  const repo = { ...tracked.repo, config: { ...tracked.repo.config, commands: { ...tracked.repo.config.commands, env } } };
  const tree = tracked.trees["data"] ?? "";
  await writeRunner(repo, tree, "data");
  return { ...tracked, repo, tree };
}

async function onlyResult(tree: string): Promise<Record<string, string>> {
  const results = join(tree, RESULTS);
  const [id] = (await readdir(results)).filter((name) => !name.endsWith(".tmp"));
  if (id === undefined) throw new Error("the runner left no result");
  const fields: Record<string, string> = { id };
  for (const name of await readdir(join(results, id))) fields[name] = await readFile(join(results, id, name), "utf8");
  return fields;
}

describe("the runner tally writes into a worktree", () => {
  test("is a file the agent can run", async () => {
    const { tree } = await ready();

    expect(((await stat(join(tree, RUNNER))).mode & 0o111) !== 0).toBe(true);
  });

  test("runs the command, shows its output and leaves a result with what happened", async () => {
    const { tree, root } = await ready();

    const ran = await run(tree, ["green", "--task", "B2:4 manifest", "--", "sh", "-c", "echo hello"]);

    expect(ran.exit).toBe(0);
    expect(ran.output).toContain("hello");
    const result = await onlyResult(tree);
    expect(result["kind"]).toBe("green\n");
    expect(result["task"]).toBe("B2:4 manifest\n");
    expect(result["exit"]).toBe("0\n");
    expect(result["head"]).toBe(`${await sh(tree, ["rev-parse", "HEAD"])}\n`);
    expect(result["cwd"]).toBe(`${tree}\n`);
    expect(result["argv"]).toBe("sh\0-c\0echo hello\0");
    expect(result["started"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n$/);
    expect(Number(result["seconds"])).toBeGreaterThanOrEqual(0);
    const log = (result["log"] ?? "").trim();
    expect(log.startsWith(join(root, LOGS, "data"))).toBe(true);
    expect(await readFile(log, "utf8")).toContain("hello");
  });

  test("exits as the command did and keeps what it wrote to stderr", async () => {
    const { tree } = await ready();

    const ran = await run(tree, ["red", "--task", "B2:4 manifest", "--", "sh", "-c", "echo broken >&2; exit 3"]);

    expect(ran.exit).toBe(3);
    const result = await onlyResult(tree);
    expect(result["exit"]).toBe("3\n");
    expect(await readFile((result["log"] ?? "").trim(), "utf8")).toContain("broken");
  });

  test("gives the command the config's environment", async () => {
    const { tree } = await ready({ GREETING: "it's set", EMPTY: "" });

    await run(tree, ["green", "--task", "B2:4 manifest", "--", "sh", "-c", "echo \"$GREETING\""]);

    expect(await readFile(((await onlyResult(tree))["log"] ?? "").trim(), "utf8")).toContain("it's set");
  });

  test("passes arguments through untouched, quotes and spaces included", async () => {
    const { tree } = await ready();

    await run(tree, ["green", "--task", "B2:4 manifest", "--", "printf", "%s|", "a b", "c'd", "e\"f"]);

    const result = await onlyResult(tree);
    expect(result["argv"]).toBe("printf\0%s|\0a b\0c'd\0e\"f\0");
    expect(await readFile((result["log"] ?? "").trim(), "utf8")).toBe("a b|c'd|e\"f|");
  });

  test("takes an optional note and no task", async () => {
    const { tree } = await ready();

    await run(tree, ["green", "--note", "after the rename", "--", "true"]);

    const result = await onlyResult(tree);
    expect(result["task"]).toBe("\n");
    expect(result["note"]).toBe("after the rename\n");
  });

  test("refuses a kind that is not a plain word, so a log never lands outside its folder", async () => {
    const { tree } = await ready();

    const ran = await run(tree, ["../../escape", "--task", "B2:4 manifest", "--", "true"]);

    expect(ran.exit).toBe(2);
    await expect(readdir(join(tree, RESULTS))).rejects.toThrow();
  });

  test("refuses a call with no command and leaves no result", async () => {
    const { tree } = await ready();

    const ran = await run(tree, ["green", "--task", "B2:4 manifest"]);

    expect(ran.exit).toBe(2);
    expect(ran.output).toContain("usage: .temp/tally/run <kind> [--task MILESTONE:TASK] [--note TEXT] [--scope TEXT] -- <command...>");
    await expect(readdir(join(tree, RESULTS))).rejects.toThrow();
  });
});
