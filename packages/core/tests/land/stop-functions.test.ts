import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stopFunctions } from "../../src/land/land-stop.ts";

const LIMIT_MS = 30_000;

function ran(command: string, args: readonly string[], detached = false): Promise<number> {
  return new Promise((done) => {
    const child = spawn(command, args, { detached, stdio: "ignore" });
    child.on("exit", (code) => done(code ?? 1));
  });
}

async function harness(body: readonly string[]): Promise<{ script: string; out: string }> {
  const out = await mkdtemp(join(tmpdir(), "tally-stop-"));
  const script = join(out, "harness.sh");
  const lines = ["set -u", `out=${out}`, `log=${out}/log`, `checkout=${out}`, `owner=${out}/owner`, `final=${out}/final`, ...stopFunctions(undefined), ...body];
  await writeFile(script, `${lines.join("\n")}\n`);
  return { script, out };
}

const text = (path: string): Promise<string> => readFile(path, "utf8").catch(() => "");

describe("the landing script's check runner", () => {
  test("removes the check's group and pid files as soon as it returns, so a stop between two checks sends no signal", async () => {
    const { script, out } = await harness(['kill() { echo "kill $*" >> "$out/signals"; }', "sleep() { :; }", "run_check true", "stop_check"]);

    await ran("sh", [script]);

    expect([await text(join(out, "signals")), await text(join(out, "group")), await text(join(out, "pid"))]).toEqual(["", "", ""]);
  });

  test("sends the second signal only if the check's file still names the same group, or the same process", async () => {
    const ending = ['kill() { echo "kill $*" >> "$out/signals"; }', 'sleep() { rm -f "$out/group" "$out/pid"; }'];
    const grouped = await harness([...ending, 'echo 4242 > "$out/group"', 'echo 4243 > "$out/pid"', "stop_check"]);
    const alone = await harness([...ending, 'echo 4243 > "$out/pid"', "stop_check"]);

    await ran("sh", [grouped.script]);
    await ran("sh", [alone.script]);

    expect([await text(join(grouped.out, "signals")), await text(join(alone.out, "signals"))]).toEqual(["kill -TERM -4242\n", "kill -TERM 4243\n"]);
  });

  test("uses setsid --wait where the installed setsid takes it", async () => {
    const { script, out } = await harness(['printf "%s" "$setsid_wait" > "$out/wait"']);

    await ran("sh", [script]);

    expect(await text(join(out, "wait"))).toBe((await ran("setsid", ["--wait", "true"])) === 0 ? "--wait" : "");
  });

  test("records a failing check as failed when the script was started as a group leader", async () => {
    const { script, out } = await harness(["run_check sh -c 'sleep 1; exit 7'", 'echo "$?" > "$out/rc"']);

    await ran("sh", [script], true);

    expect(await text(join(out, "rc"))).toBe("7\n");
  }, LIMIT_MS);

  test("needs --wait: setsid run by a group leader forks and answers 0 before its child ends", async () => {
    const without = await ran("setsid", ["sh", "-c", "sleep 1; exit 7"], true);
    const waited = await ran("setsid", ["--wait", "sh", "-c", "sleep 1; exit 7"], true);

    expect([without, waited]).toEqual([0, 7]);
  }, LIMIT_MS);
});
