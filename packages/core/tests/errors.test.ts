import { describe, expect, test } from "vitest";
import { namedList } from "../src/errors.ts";

describe("a list of names in a message", () => {
  test("is given whole while it is short", () => {
    expect(namedList(["a.rs", "b.rs"])).toBe("a.rs, b.rs");
    expect(namedList([])).toBe("");
  });

  test("is cut at its limit, with how many more there are", () => {
    const files = Array.from({ length: 23 }, (_, index) => `f${index}`);

    expect(namedList(files)).toBe(`${files.slice(0, 20).join(", ")} and 3 more`);
    expect(namedList(["a", "b", "c"], 2)).toBe("a, b and 1 more");
  });
});
