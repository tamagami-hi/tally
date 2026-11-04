import type { Snapshot } from "../src/types.ts";

export const snapshot: Snapshot = {
  takenAt: "2026-11-03T18:00:00Z",
  status: {
    name: "Example",
    time: "2026-11-03 23:30",
    overall: 0.52,
    stagePct: { A: 1, B: 0.385, C: 0 },
    stages: [{ id: "A", name: "the first slice" }, { id: "B", name: "widening" }, { id: "C", name: "later" }],
    rows: [
      { id: "A0-A7", stage: "A", name: "the first slice", track: "all", weight: 100, built: "aaa..bbb", share: 1, count: null, notes: ["built"], tasks: [] },
      { id: "B4", stage: "B", name: "simulator", track: "alpha+beta", weight: 14, share: 18 / 23, count: [18, 23], notes: ["beta next: T8 candle_close", "T9 store: waits for B2"], tasks: [] },
      { id: "B5", stage: "B", name: "full builder", track: "beta", weight: 14, share: 0, count: null, notes: ["not started"], tasks: [] },
      { id: "C1", stage: "C", name: "candles", track: "-", weight: 34, waits: "candle files", share: 0, count: null, notes: ["waits for candle files"], tasks: [] },
    ],
    tracks: [
      { branch: "main", track: "main", path: ".", head: "ee8999a", subject: "records: a note", ct: 0, when: "2 min ago", ahead: 0, behind: 0, dirty: 0, files: [], isMain: true },
      { branch: "track/alpha", track: "alpha", path: "/w/alpha", head: "a7caeea", subject: "feat(store): grids", ct: 0, when: "34 min ago", ahead: 0, behind: 2, dirty: 2, files: [
        { status: "M", path: "crates/core/src/store/mod.rs", add: "7", del: "0" },
        { status: "??", path: "crates/core/src/store/manifest.rs", add: "", del: "" },
      ], isMain: false },
    ],
    main: "ee8999a records: a note",
    origin: "d0ff4a5",
    unpushed: 42,
    today: 30,
    questions: ["36 (engine)"],
    nextRow: 38,
    problems: [],
  },
  graph: [
    { hash: "ee8999a", parents: ["f9d2c16"], subject: "records: a note", author: "t", ct: 0, when: "2 min ago", labels: ["main"], pushed: false, lane: 0, top: [], bottom: [[0, 0]], width: 1 },
    { hash: "f9d2c16", parents: ["401dcd6"], subject: "docs(rules): the ledger", author: "t", ct: 0, when: "5 min ago", labels: [], pushed: false, lane: 0, top: [[0, 0]], bottom: [[0, 0]], width: 1 },
    { hash: "401dcd6", parents: [], subject: "records: import", author: "t", ct: 0, when: "9 min ago", labels: ["origin/main"], pushed: true, lane: 0, top: [[0, 0]], bottom: [], width: 1 },
  ],
};
