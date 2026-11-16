import { describe, expect, test } from "vitest";
import { countsLine, dayText, endedText, lengthText, partText, spanText } from "../src/done-text.ts";
import { local } from "./done-fixture.ts";

describe("the words of the Done view", () => {
  test("a length in minutes, hours and days", () => {
    expect(lengthText(20_000)).toBe("under a minute");
    expect(lengthText(40 * 60_000)).toBe("40 min");
    expect(lengthText(105 * 60_000)).toBe("1 h 45 min");
    expect(lengthText(120 * 60_000)).toBe("2 h");
    expect(lengthText(50 * 3_600_000)).toBe("2 days");
  });

  test("a session's span, with the day of its end only when it is another day", () => {
    expect(dayText(local(14, 10, 2))).toBe("2026-11-14");
    expect(spanText(local(14, 10, 2), local(14, 11, 47))).toBe("10:02 to 11:47, 1 h 45 min");
    expect(spanText(local(13, 23, 50), local(14, 0, 30))).toBe("23:50 to 2026-11-14 00:30, 40 min");
  });

  test("how a session ended", () => {
    expect(endedText("closed")).toBe("closed");
    expect(endedText("expired")).toBe("expired");
    expect(endedText("unknown")).toBe("no close recorded");
  });

  test("the counts, each in its own number", () => {
    expect(countsLine({ phasesClosed: 1, milestonesFinished: 10, tasksLanded: 63 })).toBe("1 phase closed · 10 milestones finished · 63 tasks landed");
    expect(countsLine({ phasesClosed: 0, milestonesFinished: 1, tasksLanded: 1 })).toBe("0 phases closed · 1 milestone finished · 1 task landed");
  });

  test("a deferred part, by its state", () => {
    expect(partText({ what: "the docs", to: "B2:3 index", state: "waiting" })).toBe("the docs: left to B2:3 index, not landed yet");
    expect(partText({ what: "the index", to: "B2:2 writer", state: "done" })).toBe("the index: done in B2:2 writer");
    expect(partText({ what: "the cache", why: "not needed yet", state: "parked" })).toBe("the cache: parked, not needed yet");
    expect(partText({ what: "the manual", state: "unplaced" })).toBe("the manual: left to no task");
  });
});
