import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { STAMP_FILE, buildPlaceOf, staleWarning, writeStamp, type BuildPlace } from "../src/build-stamp.ts";
import { entry } from "../src/entry.ts";
import type { IO } from "../src/io.ts";
import { run } from "../src/run.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

function io(cwd: string, env: NodeJS.ProcessEnv = {}): Captured {
  const captured: Captured = { lines: [], errors: [], out: (line) => captured.lines.push(line), err: (line) => captured.errors.push(line), cwd, env, columns: 120, isTTY: false };
  return captured;
}

async function placed(source: string, built?: string): Promise<BuildPlace> {
  const root = await tmpDir("tally-build-");
  const dist = join(root, "dist");
  await mkdir(dist);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@tally/cli", version: source }));
  if (built !== undefined) await writeFile(join(dist, STAMP_FILE), JSON.stringify({ version: built, builtAt: "2026-11-13T10:00:00.000Z" }));
  return { packageJson: join(root, "package.json"), dist };
}

describe("the build's stamp", () => {
  test("is written by the last step of npm run build, from a script the image's build stage has", async () => {
    const root = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")) as { scripts: { build: string } };

    expect(root.scripts.build.split(" && ").at(-1)).toBe("node packages/cli/dist/stamp-build.js");
    await expect(access(new URL("../src/stamp-build.ts", import.meta.url))).resolves.toBeUndefined();
  });

  test("names the version of the package it was built from, and when", async () => {
    const place = await placed("0.6.0");

    const stamp = await writeStamp(place, new Date("2026-11-17T10:00:00.000Z"));

    expect(stamp).toEqual({ version: "0.6.0", builtAt: "2026-11-17T10:00:00.000Z" });
    expect(JSON.parse(await readFile(join(place.dist ?? "", STAMP_FILE), "utf8"))).toEqual(stamp);
  });

  test("is looked for in dist when the code runs from a build, and not when it runs from source", () => {
    expect(buildPlaceOf(pathToFileURL("/x/packages/cli/dist/main.js").href)).toEqual({ packageJson: "/x/packages/cli/package.json", dist: "/x/packages/cli/dist" });
    expect(buildPlaceOf(pathToFileURL("/x/packages/cli/src/main.ts").href)).toEqual({ packageJson: "/x/packages/cli/package.json", dist: null });
  });
});

describe("a build older than its source", () => {
  test("is silent when the stamp names the source's version", async () => {
    expect(await staleWarning(await placed("0.6.0", "0.6.0"))).toBeUndefined();
  });

  test("says the version it was built at, the source's, and how to rebuild", async () => {
    const warning = await staleWarning(await placed("0.6.0", "0.5.1"));

    expect(warning).toBe("tally: this build is 0.5.1, built 2026-11-13T10:00:00.000Z, but its source is 0.6.0; npm run build rebuilds it");
  });

  test("says so when it has no stamp", async () => {
    const place = await placed("0.6.0");

    expect(await staleWarning(place)).toBe(`tally: this build has no stamp in ${place.dist ?? ""}, so it may be older than its source, 0.6.0; npm run build rebuilds it`);
  });

  test("checks nothing when it runs from source", async () => {
    const place = await placed("0.6.0");

    expect(await staleWarning({ ...place, dist: null })).toBeUndefined();
  });

  test("warns once on the error stream and keeps the command's output and exit code", async () => {
    const cwd = await tmpDir("tally-nowhere-");
    const stale = await placed("0.6.0", "0.5.1");
    const [plain, warned] = [io(cwd), io(cwd)];

    const plainExit = await run(["ledger", "check"], plain);
    const warnedExit = await entry(["ledger", "check"], warned, stale);

    expect(warnedExit).toBe(plainExit);
    expect(warned.lines).toEqual(plain.lines);
    expect(warned.errors).toEqual([(await staleWarning(stale)) ?? "", ...plain.errors]);
  });

  test("says nothing extra from a build that matches its source", async () => {
    const cwd = await tmpDir("tally-nowhere-");
    const current = io(cwd);

    expect(await entry(["--help"], current, await placed("0.6.0", "0.6.0"))).toBe(0);
    expect(current.errors).toEqual([]);
  });
});
