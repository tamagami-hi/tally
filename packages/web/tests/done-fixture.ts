import type { DoneWork, EndedSession, EndedSessions } from "../src/types.ts";

export const local = (day: number, hour: number, minute: number): string => new Date(2026, 10, day, hour, minute).toISOString();

export const work: DoneWork = {
  counts: { phasesClosed: 1, milestonesFinished: 2, tasksLanded: 4 },
  phases: [
    {
      id: "H", name: "the reader", goal: "Read every format.", state: "closed", closedAt: "2026-11-14T12:00:00.000Z",
      closedBy: { track: "main", agent: "operator" }, summary: "The reader shipped.", commit: "c0ffee1", share: 1,
      milestones: { finished: 1, total: 1 }, tasks: { landed: 1, total: 1 },
      rows: [{ id: "H1", name: "csv reader", track: "alpha", finished: true, count: [1, 1], tasks: [
        { id: "1 csv", track: "alpha", commit: "abc1234", also: ["abc5678", "abc9999"], at: local(13, 16, 45), dated: "commit", deferred: [
          { what: "the docs", to: "B2:3 index", state: "waiting" },
          { what: "the cache", why: "not needed yet", state: "parked" },
          { what: "the index", to: "B2:2 writer", state: "done" },
          { what: "the manual", state: "unplaced" },
        ] },
      ] }],
    },
    {
      id: "W", name: "the widening", state: "open", share: 0.84,
      milestones: { finished: 1, total: 3 }, tasks: { landed: 3, total: 6 },
      rows: [
        { id: "B2", name: "writer", track: "alpha+beta", finished: false, count: [3, 5], tasks: [
          { id: "2 writer", track: "beta", commit: "def1234", also: [], at: local(12, 9, 0), dated: "recorded" },
          { id: "1 reader", track: "alpha", commit: "def5678", also: [] },
        ] },
        { id: "B5", name: "packager", track: "beta", finished: true, built: "aaa1111..bbb2222", count: null, tasks: [] },
      ],
    },
  ],
};

const ended = (id: string, more: Partial<EndedSession> = {}): EndedSession => ({ id, track: "alpha", agent: "claude", from: local(14, 10, 2), to: local(14, 11, 47), opened: "first write", ended: "closed", writes: 12, tasks: ["B2 / 2 writer"], ...more });

export const sessions: EndedSessions = {
  kept: true,
  total: 3,
  sessions: [
    ended("s1", { agent: "kiro", track: "beta", opened: "recorded" }),
    ended("s2", { ended: "expired", from: local(13, 23, 50), to: local(14, 0, 30), tasks: Array.from({ length: 8 }, (_, index) => `B2 / t${index}`), moreTasks: 2 }),
    ended("s3", { ended: "unknown", writes: 1, tasks: [] }),
  ],
};
