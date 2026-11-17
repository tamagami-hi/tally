import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { STAMP_FILE, type BuildPlace } from "../src/build-stamp.ts";
import { versionCommand } from "../src/commands/version.ts";
import type { IO } from "../src/io.ts";
import { run } from "../src/run.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) await new Promise((done) => servers.pop()?.close(done));
});

function io(env: NodeJS.ProcessEnv = {}): Captured {
  const captured: Captured = { lines: [], errors: [], out: (line) => captured.lines.push(line), err: (line) => captured.errors.push(line), cwd: "/", env, columns: 120, isTTY: false };
  return captured;
}

async function placed(source: string, built?: string): Promise<BuildPlace> {
  const root = await tmpDir("tally-build-");
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "package.json"), JSON.stringify({ version: source }));
  if (built !== undefined) await writeFile(join(root, "dist", STAMP_FILE), JSON.stringify({ version: built, builtAt: "2026-11-13T10:00:00.000Z" }));
  return { packageJson: join(root, "package.json"), dist: join(root, "dist") };
}

async function serviceAnswering(health: unknown): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(health));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("tally version", () => {
  test("prints the source's and the build's versions and exits 0 when they agree", async () => {
    const console = io();

    expect(await versionCommand([], console, await placed("0.6.0", "0.6.0"))).toBe(0);
    expect(console.lines).toEqual(["source   0.6.0", "build    0.6.0, built 2026-11-13T10:00:00.000Z", "they agree"]);
  });

  test("says the build differs and exits 1 when it was built at another version", async () => {
    const console = io();

    expect(await versionCommand([], console, await placed("0.6.0", "0.5.1"))).toBe(1);
    expect(console.lines.at(-1)).toBe("the build is 0.5.1 and the source 0.6.0: npm run build rebuilds it");
  });

  test("exits 1 when the build has no stamp", async () => {
    const console = io();
    const place = await placed("0.6.0");

    expect(await versionCommand([], console, place)).toBe(1);
    expect(console.lines).toEqual(["source   0.6.0", `build    unknown: no stamp in ${place.dist ?? ""}`, "the build's version is unknown: npm run build rebuilds it"]);
  });

  test("says when it runs from source, and exits 0", async () => {
    const console = io();

    expect(await run(["version"], console)).toBe(0);
    expect(console.lines[1]).toBe("build    none: this runs from source");
  });

  test("with TALLY_URL, adds the service's version and says when it differs, still exiting by the build alone", async () => {
    const url = await serviceAnswering({ ok: true, version: "0.5.1" });
    const console = io({ TALLY_URL: url });

    expect(await versionCommand([], console, await placed("0.6.0", "0.6.0"))).toBe(0);
    expect(console.lines).toEqual(["source   0.6.0", "build    0.6.0, built 2026-11-13T10:00:00.000Z", `service  0.5.1 at ${url}`, "the service is 0.5.1 and the source 0.6.0"]);
  });

  test("says when the service does not say its version, or cannot be reached", async () => {
    const older = await serviceAnswering({ ok: true });
    const [quiet, away] = [io({ TALLY_URL: older }), io({ TALLY_URL: "http://127.0.0.1:9" })];

    await versionCommand([], quiet, await placed("0.6.0", "0.6.0"));
    await versionCommand([], away, await placed("0.6.0", "0.6.0"));

    expect(quiet.lines[2]).toBe(`service  unknown: ${older} answers, but not with its version, so it is older than 0.6.0`);
    expect(away.lines[2]).toBe("service  unknown: nothing answers at http://127.0.0.1:9");
  });

  test("is carried out here with TALLY_URL set, never by the service, and refuses arguments", async () => {
    const console = io({ TALLY_URL: "http://127.0.0.1:9" });

    expect(await run(["version"], console)).toBe(0);
    expect(await run(["version", "--json"], io())).toBe(2);
  });
});
