import { describe, expect, test } from "vitest";
import { applies, overlaps } from "../../src/context/match.ts";

describe("which files a context path applies to", () => {
  test.each([
    ["packages/core/src/land/turn.ts", "packages/core/src/land/turn.ts", true],
    ["packages/core", "packages/core/src/land/turn.ts", true],
    ["packages/core/", "./packages/core/src/a.ts", true],
    ["packages/cor", "packages/core/src/a.ts", false],
    ["packages/mcp", "packages/core/src/a.ts", false],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/deep/a.ts", false],
    ["packages/*/src", "packages/core/src/a.ts", true],
    ["packages/*/src", "packages/core/tests/a.ts", false],
    ["src/**/*.test.ts", "src/a/b/c.test.ts", true],
    ["src/**/*.test.ts", "src/c.test.ts", true],
    ["src/**/*.test.ts", "src/a/b/c.ts", false],
    ["**/*.md", "docs/a/b.md", true],
    ["**/*.md", "docs/a/b.ts", false],
    ["src/**", "lib/a.ts", false],
    ["a.b/c+d.ts", "a.b/c+d.ts", true],
    ["a.b/c+d.ts", "axb/c+d.ts", false],
  ])("%s on %s: %s", (path, file, expected) => {
    expect(applies(path, file)).toBe(expected);
  });

  test.each([
    ["packages/core/src/land/turn.ts", "packages/core", false],
    ["packages/core/src/land/turn.ts", "packages/core/", true],
    ["packages/core/src/land/**", "packages/core/", true],
    ["packages/core/src/land/**", "packages/mcp/", false],
    ["packages/*/tests/**", "packages/mcp/", true],
    ["packages/core/src/*.ts", "packages/core/**", true],
    ["packages/core/src/*.ts", "packages/*/src/*.tsx", false],
    ["packages/core/src/a*.ts", "packages/*/src/ab*.ts", true],
    ["**/*.md", "docs/a/", true],
    ["src/**", "src", true],
    ["docs/a.md", "", true],
    ["docs/a.md", "./", true],
  ])("asked with a folder that ends in a slash, or with a glob, %s applies to %s when something under it could: %s", (path, asked, expected) => {
    expect(applies(path, asked)).toBe(expected);
  });

  test.each([
    ["packages/core/src/land/**", "packages/core", true],
    ["packages/core/src/land/turn.ts", "packages/core", true],
    ["packages/core", "packages/core/src", true],
    ["packages/*/tests", "packages/mcp", true],
    ["packages/mcp/tests", "packages/core", false],
    ["**/*.md", "docs", true],
  ])("%s overlaps the area %s: %s", (path, area, expected) => {
    expect(overlaps(path, area)).toBe(expected);
  });
});
