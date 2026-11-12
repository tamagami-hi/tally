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
    ["src/a*b*c.ts", "src/a1b2c.ts", true],
    ["src/a*b*c.ts", "src/acb.ts", false],
    ["src/*a", "src/a", true],
    ["src/a*a", "src/a", false],
    ["src/a*a", "src/aba", true],
    ["src/**/**/x.ts", "src/x.ts", true],
    ["src/**/a/**/x.ts", "src/b/x.ts", false],
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

  test("a path of many ** is decided at once, however deep the file", () => {
    const deep = `${"d/".repeat(30)}y`;

    expect(applies("**/**/**/**/**/**/**/**/x", deep)).toBe(false);
    expect(applies("**/**/**/**/**/**/**/**/y", deep)).toBe(true);
    expect(overlaps(deep, "**/**/**/**/**/**/**/**/x")).toBe(true);
  });

  test("a segment of many * is decided at once, however long the name", () => {
    const long = "a".repeat(200);

    expect(applies("a*a*a*a*a*b", long)).toBe(false);
    expect(applies("a*a*a*a*a*a", long)).toBe(true);
    expect(applies(long, "a*a*a*a*a*b")).toBe(false);
  });
});
