import { describe, expect, test } from "vitest";
import { checksFor, matchesPath } from "../../src/land/path-checks.ts";

const check = (name: string, ...paths: string[]) => ({ name, command: ["true"], paths });

describe("a check's path against a changed file", () => {
  test("matches the file it names, and no other", () => {
    expect(matchesPath("README.md", "README.md")).toBe(true);
    expect(matchesPath("README.md", "README.mdx")).toBe(false);
    expect(matchesPath("README.md", "docs/README.md")).toBe(false);
  });

  test("matches every file under the folder it names, with or without a closing slash", () => {
    expect(matchesPath("packages/web", "packages/web/src/App.tsx")).toBe(true);
    expect(matchesPath("packages/web/", "packages/web/src/App.tsx")).toBe(true);
    expect(matchesPath("./packages/web", "packages/web/package.json")).toBe(true);
    expect(matchesPath("packages/web", "packages/webapp/index.ts")).toBe(false);
  });

  test("lets * stand for any run of characters inside one segment", () => {
    expect(matchesPath("src/*.ts", "src/a.ts")).toBe(true);
    expect(matchesPath("src/*.ts", "src/deep/a.ts")).toBe(false);
    expect(matchesPath("*.md", "README.md")).toBe(true);
    expect(matchesPath("*.md", "docs/guide.md")).toBe(false);
    expect(matchesPath("packages/*/package.json", "packages/core/package.json")).toBe(true);
    expect(matchesPath("packages/*/package.json", "packages/core/src/package.json")).toBe(false);
  });

  test("lets ** stand for any depth, none included", () => {
    expect(matchesPath("docs/**", "docs/guide.md")).toBe(true);
    expect(matchesPath("docs/**", "docs/plans/2026/one.md")).toBe(true);
    expect(matchesPath("docs/**", "src/docs.ts")).toBe(false);
    expect(matchesPath("**/*.md", "README.md")).toBe(true);
    expect(matchesPath("**/*.md", "docs/plans/one.md")).toBe(true);
    expect(matchesPath("src/**/mod.rs", "src/mod.rs")).toBe(true);
    expect(matchesPath("src/**/mod.rs", "src/a/b/mod.rs")).toBe(true);
    expect(matchesPath("src/**/mod.rs", "src/a/b/lib.rs")).toBe(false);
  });

  test("reads a glob against the whole file path, so it is not also a folder", () => {
    expect(matchesPath("packages/*", "packages/README.md")).toBe(true);
    expect(matchesPath("packages/*", "packages/web/src/App.tsx")).toBe(false);
    expect(matchesPath("packages/*/**", "packages/web/src/App.tsx")).toBe(true);
  });

  test("takes every other character as itself", () => {
    expect(matchesPath("a+b/c.d", "a+b/c.d")).toBe(true);
    expect(matchesPath("a+b/c.d", "aab/cxd")).toBe(false);
    expect(matchesPath("src/[id]/*.ts", "src/[id]/page.ts")).toBe(true);
    expect(matchesPath("src/[id]/*.ts", "src/i/page.ts")).toBe(false);
  });
});

describe("the checks of a landing", () => {
  const listed = [check("core", "packages/core"), check("web", "packages/web", "*.html"), check("docs", "**/*.md")];

  test("are those with a path matching at least one changed file, in the config's order", () => {
    expect(checksFor(listed, ["docs/guide.md", "packages/core/src/a.ts"]).map((one) => one.name)).toEqual(["core", "docs"]);
    expect(checksFor(listed, ["index.html"]).map((one) => one.name)).toEqual(["web"]);
  });

  test("are none when no path matches", () => {
    expect(checksFor(listed, ["scripts/build.sh"])).toEqual([]);
    expect(checksFor(listed, [])).toEqual([]);
  });
});
