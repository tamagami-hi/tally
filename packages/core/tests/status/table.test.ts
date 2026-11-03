import { describe, expect, test } from "vitest";
import { Paint, Raw, bar, clip, fit, table, wrap } from "../../src/status/table.ts";

const plain = new Paint(false);

describe("wrapping and fitting", () => {
  test("wraps on spaces and breaks a word longer than the width", () => {
    expect(wrap("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("", 4)).toEqual([""]);
    expect(wrap("A1  reader", 20)).toEqual(["A1  reader"]);
  });

  test("gives the flexible column what is left of the width, at least its minimum", () => {
    expect(fit([5, 24, 14, 0, 16], 3, 120, 22)).toEqual([5, 24, 14, 45, 16]);
    expect(fit([5, 24, 14, 0, 16], 3, 60, 22)).toEqual([5, 24, 14, 22, 16]);
  });

  test("clips with an ellipsis", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
  });
});

describe("the boxed table", () => {
  test("draws headers, wrapped cells, a divider and raw cells", () => {
    const rows = [["A", "one two three", new Raw("##", 2)], "---", [["B", ["1"]], "x", new Raw("#", 1)]];
    const out = table(["H1", "H2", "H3"], rows, [2, 7, 2], plain);
    expect(out.split("\n")).toEqual([
      "┌────┬─────────┬────┐",
      "│ H1 │ H2      │ H3 │",
      "├────┼─────────┼────┤",
      "│ A  │ one two │ ## │",
      "│    │ three   │    │",
      "├────┼─────────┼────┤",
      "│ B  │ x       │ #  │",
      "└────┴─────────┴────┘",
    ]);
  });

  test("paints only when on, and a bar fills by share", () => {
    expect(new Paint(true).call("x", "1")).toBe("\u001b[1mx\u001b[0m");
    expect(plain.call("x", "1")).toBe("x");
    expect(bar(0.5, 4, plain)).toBe("██░░");
    expect(bar(1, 2, plain)).toBe("██");
  });
});
