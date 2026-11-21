import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACKAGES = join(ROOT, "packages");
const SDK_V1 = "@modelcontextprotocol/sdk";
const OLDER_CLIENT_TEST = "packages/server/tests/older-sdk.test.ts";
const SOURCE = /\.(ts|tsx|js|mjs)$/;
const LEAST_ZOD_MINOR = 2;
const IMPORTS_V1 = new RegExp(`(from|import|require)\\s*\\(?\\s*["']${SDK_V1.replace("/", "\\/")}`);

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesUnder(join(folder, entry.name)) : Promise.resolve(SOURCE.test(entry.name) ? [join(folder, entry.name)] : []))));
  return nested.flat();
}

async function packageNames(): Promise<string[]> {
  return (await readdir(PACKAGES, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

const manifestOf = async (folder: string): Promise<Manifest> => JSON.parse(await readFile(join(folder, "package.json"), "utf8")) as Manifest;

describe("the packages tally ships", () => {
  test("import nothing from version 1 of the SDK, in source or in tests, but the one test of an older client", async () => {
    const files = (await Promise.all((await packageNames()).flatMap((name) => [filesUnder(join(PACKAGES, name, "src")), filesUnder(join(PACKAGES, name, "tests"))]))).flat();
    const importing = [];
    for (const file of files) if (IMPORTS_V1.test(await readFile(file, "utf8"))) importing.push(relative(ROOT, file));

    expect(importing.filter((file) => file !== OLDER_CLIENT_TEST)).toEqual([]);
  });

  test("do not depend on version 1 of the SDK; the server package of version 2 is the MCP package's", async () => {
    const manifests = await Promise.all((await packageNames()).map((name) => manifestOf(join(PACKAGES, name))));
    const root = await manifestOf(ROOT);

    expect(manifests.filter((manifest) => manifest.dependencies?.[SDK_V1] !== undefined).map((manifest) => manifest.name)).toEqual([]);
    expect(root.dependencies?.[SDK_V1]).toBeUndefined();
    expect(manifests.find((manifest) => manifest.name === "@tally/mcp")?.dependencies?.["@modelcontextprotocol/server"]).toMatch(/^\^2\./);
  });

  test("declare zod at 4.2 or later, and every package resolves the one copy", async () => {
    const names = await packageNames();
    const manifests = await Promise.all(names.map((name) => manifestOf(join(PACKAGES, name))));
    const ranges = manifests.flatMap((manifest) => [manifest.dependencies?.["zod"], manifest.devDependencies?.["zod"]]).filter((range) => range !== undefined);
    const resolved = new Set(names.map((name) => createRequire(join(PACKAGES, name, "package.json")).resolve("zod")));

    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      const [major, minor] = range.replace(/^\^/, "").split(".").map(Number);
      expect([range, major === 4 && (minor ?? 0) >= LEAST_ZOD_MINOR]).toEqual([range, true]);
    }
    expect([...resolved]).toHaveLength(1);
    expect([...resolved][0]?.startsWith(ROOT)).toBe(true);
  });
});
