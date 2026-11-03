import { describe, expect, test } from "vitest";
import { percent, splitNote, tone } from "../src/format.ts";

describe("formatting", () => {
  test("tones a share and rounds a percent", () => {
    expect(tone(1)).toBe("done");
    expect(tone(0.3)).toBe("active");
    expect(tone(0)).toBe("idle");
    expect(percent(0.385)).toBe("39%");
  });

  test("reads the summary's notes into their kinds", () => {
    expect(splitNote("engine next: T8 candle_close")).toEqual({ kind: "next", text: "T8 candle_close (engine)" });
    expect(splitNote("T9 store: waits for B2")).toEqual({ kind: "waits", text: "T9 store waits for B2" });
    expect(splitNote("built")).toEqual({ kind: "plain", text: "built" });
  });
});
