import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stopFunctions } from "../../src/land/land-stop.ts";


function ran(command: string, args: readonly string[]): Promise<number> {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: "ignore" });
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
});
