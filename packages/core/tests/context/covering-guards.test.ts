import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { covering } from "../../src/context/covering.ts";
import { cycling } from "../support/cycling.ts";

const PATH = process.env["PATH"] ?? "";
const SEPARATOR = "\u001f";

afterEach(() => {
  process.env["PATH"] = PATH;
});

async function watchingGit(): Promise<() => Promise<string[][]>> {
  const bin = await mkdtemp(join(tmpdir(), "tally-git-"));
  const log = join(bin, "calls");
  await writeFile(log, "");
  await writeFile(join(bin, "git"), `#!/bin/sh\n{ for a in "$@"; do printf '%s${SEPARATOR}' "$a"; done; printf '\\n'; } >> '${log}'\nexec /usr/bin/git "$@"\n`);
  await chmod(join(bin, "git"), 0o755);
  process.env["PATH"] = `${bin}:${PATH}`;
  return async () => (await readFile(log, "utf8")).split("\n").filter((line) => line !== "").map((line) => line.split(SEPARATOR).slice(0, -1));
}

describe("covering's guards on a range's sides", () => {
  test("a side git would take as an option never reaches git", async () => {
    const { repo } = await cycling();
    const calls = await watchingGit();

    await expect(covering(repo, { range: "--all..HEAD" })).rejects.toThrow("'--all' is not a commit");

    expect((await calls()).filter((argv) => argv.some((arg) => arg.startsWith("--all")))).toEqual([]);
  });

  test("a side is proved a commit only after --end-of-options", async () => {
    const { repo, landed } = await cycling();
    const calls = await watchingGit();

    await covering(repo, { range: `${landed}~1..${landed}` });

    const proofs = (await calls()).filter((argv) => argv.includes("rev-parse") && argv.some((arg) => arg.endsWith("^{commit}")));
    expect(proofs.map((argv) => argv[argv.findIndex((arg) => arg.endsWith("^{commit}")) - 1])).toEqual(["--end-of-options", "--end-of-options"]);
  });
});
