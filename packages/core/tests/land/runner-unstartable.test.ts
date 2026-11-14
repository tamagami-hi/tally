import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { commandsRunIn } from "../../src/land/where.ts";
import { RESULTS, RUNNER, runnerLine, shellWord, writeRunner } from "../../src/land/runner.ts";
import { makeTracked } from "../support/tracked.ts";

interface Ran {
  exit: number;
  output: string;
}

function shell(cwd: string, args: readonly string[]): Promise<Ran> {
  return new Promise((done) => {
    execFile("sh", args, { cwd }, (error, stdout, stderr) => {
      const exit = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      done({ exit, output: `${String(stdout)}${String(stderr)}` });
    });
  });
}

async function ready() {
  const tracked = await makeTracked();
  const tree = tracked.trees["data"] ?? "";
  await writeRunner(tracked.repo, tree, "data");
  return { ...tracked, tree };
}

const results = (tree: string): Promise<string[]> => readdir(join(tree, RESULTS)).catch(() => []);

describe("where a project's commands run", () => {
  test("is the service unless TALLY_COMMANDS says agent", () => {
    expect(commandsRunIn({})).toBe("service");
    expect(commandsRunIn({ TALLY_COMMANDS: "" })).toBe("service");
    expect(commandsRunIn({ TALLY_COMMANDS: "service" })).toBe("service");
    expect(commandsRunIn({ TALLY_COMMANDS: "agent" })).toBe("agent");
  });

  test("refuses any other value and names the two", () => {
    expect(() => commandsRunIn({ TALLY_COMMANDS: "docker" })).toThrow("TALLY_COMMANDS is 'docker'; it takes service (tally runs a project's commands) or agent (the agent runs them in its own shell, through the runner)");
  });
});

describe("the runner and a command that could not start", () => {
  test("leaves no result for a program the shell did not find, says why and exits 127", async () => {
    const { tree } = await ready();

    const ran = await shell(tree, [join(tree, RUNNER), "sweep", "--task", "B2:4 manifest", "--", "no-such-program-here", "--flag"]);

    expect(ran.exit).toBe(127);
    expect(ran.output).toMatch(/tally: not recorded: exit 127 means the shell did not find a program \(126: it could not run it\); fix the command and run it again; the log is \S+\.log/);
    expect(await results(tree)).toEqual([]);
  });

  test("leaves no result for a program it could not run, and exits 126", async () => {
    const { tree } = await ready();
    await writeFile(join(tree, "not-runnable"), "#!/bin/sh\necho hi\n");
    await chmod(join(tree, "not-runnable"), 0o644);

    const ran = await shell(tree, [join(tree, RUNNER), "sweep", "--task", "B2:4 manifest", "--", "./not-runnable"]);

    expect(ran.exit).toBe(126);
    expect(ran.output).toContain("tally: not recorded: exit 126");
    expect(await results(tree)).toEqual([]);
  });
});

describe("the runner line tally hands an agent", () => {
  const STUB = "#!/bin/sh\nprintf '[%s]\\n' \"$PWD\"; for part in \"$@\"; do printf '[%s]\\n' \"$part\"; done\n";

  test("runs from the worktree and gives the runner back the same arguments, a space and a quote included", async () => {
    const { tree } = await ready();
    await writeFile(join(tree, RUNNER), STUB);
    const command = ["sh", "-c", "echo 'it''s done' && exit 0", "two words", "", "-x", "=ls"];

    const line = runnerLine(tree, { kind: "red", milestone: "B2", task: "4 manifest", note: "Bob's run", command });
    const ran = await shell(join(tree, ".."), ["-c", line]);

    expect(line.startsWith(`cd ${tree} && sh .temp/tally/run red`)).toBe(true);
    expect(ran.exit).toBe(0);
    expect(ran.output.split("\n").slice(0, -1)).toEqual([tree, "red", "--task", "B2:4 manifest", "--note", "Bob's run", "--", ...command].map((part) => `[${part}]`));
  });

  test("survives a worktree whose path holds a space and quotes, and an argument with a newline", async () => {
    const { tree } = await ready();
    const odd = join(tree, "it's a \"tree\"");
    await mkdir(join(odd, ".temp", "tally"), { recursive: true });
    await writeFile(join(odd, RUNNER), STUB);

    const ran = await shell(tree, ["-c", runnerLine(odd, { kind: "green", milestone: "B2", task: "x", command: ["printf", "a\nb"] })]);

    expect(ran.output).toBe(`[${odd}]\n[green]\n[--task]\n[B2:x]\n[--]\n[printf]\n[a\nb]\n`);
  });

  test("quotes a word a shell would read as something else, = at its start included", () => {
    expect(["npm", "B2:4", "--flag", "=ls", "", "a b", "~/x", "$HOME"].map(shellWord)).toEqual(["npm", "B2:4", "--flag", "'=ls'", "''", "'a b'", "'~/x'", "'$HOME'"]);
  });
});
