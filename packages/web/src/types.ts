export interface MilestoneRow {
  id: string;
  stage: string;
  name: string;
  track: string;
  weight: number;
  built?: string;
  waits?: string;
  share: number;
  count: [number, number] | null;
  notes: string[];
  tasks: { id: string; track: string; status: string; commit?: string; waits?: string }[];
}

export interface ChangedFile {
  status: string;
  path: string;
  add: string;
  del: string;
}

export interface TrackRow {
  branch: string;
  track: string;
  path: string;
  head: string;
  subject: string;
  ct: number;
  when: string;
  ahead: number;
  behind: number;
  dirty: number;
  files: ChangedFile[];
  worktree: boolean;
  isMain: boolean;
}

export interface StatusData {
  name: string;
  time: string;
  overall: number;
  stagePct: Record<string, number>;
  stages: { id: string; name: string }[];
  rows: MilestoneRow[];
  tracks: TrackRow[];
  main: string;
  origin: string | null;
  unpushed: number;
  today: number;
  questions: string[];
  nextRow: number | null;
  problems: string[];
}

export type Segment = [number, number];

export interface LaidCommit {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  ct: number;
  when: string;
  labels: string[];
  pushed: boolean;
  lane: number;
  top: Segment[];
  bottom: Segment[];
  width: number;
}

export interface LiveSession {
  id: string;
  track: string;
  agent: string;
  openedAt: string;
}

export interface LiveClaim {
  milestone: string;
  task: string;
  track: string;
  agent: string;
  since: string;
}

export interface LiveLock {
  name: string;
  agent: string;
  track: string;
  note: string;
  since: string;
}

export interface LiveState {
  sessions: LiveSession[];
  claims: LiveClaim[];
  locks: LiveLock[];
}

export interface EvidenceRecord {
  id: string;
  task: string;
  track: string;
  agent: string;
  kind: string;
  command: string[];
  cwd: string;
  started: string;
  seconds: number;
  exit: number;
  log?: { path: string; sha256: string; bytes: number };
  summary?: Record<string, number | string | boolean>;
  note?: string;
}

export interface EvidenceIndex {
  milestones: { milestone: string; records: EvidenceRecord[] }[];
}

export interface Snapshot {
  status: StatusData;
  graph: LaidCommit[];
  state?: LiveState;
  takenAt: string;
}

export type Live = "connected" | "reconnecting" | "offline";
export type Page = "board" | "tracks" | "graph" | "evidence";
export type Layout = "landscape" | "portrait";
