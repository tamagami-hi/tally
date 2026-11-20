import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("the Cycles page's text", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const ruleOf = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };

  test.each([".cycle p", ".cycle h3", ".cycle-said", ".cycle-ask"])("%s breaks a long unbroken word rather than widening the page", (selector) => {
    expect(ruleOf(selector)).toContain("overflow-wrap: anywhere");
  });
});
