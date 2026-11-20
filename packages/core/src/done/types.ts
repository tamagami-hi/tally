import type { DeferredState } from "../ledger/deferred.ts";

export interface DonePart {
  what: string;
  to?: string;
  why?: string;
  state: DeferredState;
}

export interface DoneTask {
  id: string;
  track: string;
  commit: string;
  also: string[];
  at?: string;
  dated?: "recorded" | "commit";
  deferred?: DonePart[];
  checked?: "tip";
}

export interface DoneMilestone {
  id: string;
  name: string;
  track: string;
  finished: boolean;
  built?: string;
  count: [number, number] | null;
  tasks: DoneTask[];
}

export interface DonePhase {
  id: string;
  name: string;
  goal?: string;
  state: "open" | "closed";
  closedAt?: string;
  closedBy?: { track: string; agent: string };
  summary?: string;
  commit?: string;
  share: number;
  milestones: { finished: number; total: number };
  tasks: { landed: number; total: number };
  rows: DoneMilestone[];
}

export interface DoneWork {
  counts: { phasesClosed: number; milestonesFinished: number; tasksLanded: number };
  phases: DonePhase[];
}
