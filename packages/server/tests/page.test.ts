import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const packageRoot = new URL("../../web/", import.meta.url);

describe("the web page", () => {
  test("names an icon that the build ships", () => {
    const html = readFileSync(new URL("index.html", packageRoot), "utf8");
    const href = /<link rel="icon"[^>]*href="\/([^"]+)"/.exec(html)?.[1];
    expect(href).toBe("favicon.svg");
    expect(existsSync(new URL(`public/${href ?? ""}`, packageRoot))).toBe(true);
  });
});
