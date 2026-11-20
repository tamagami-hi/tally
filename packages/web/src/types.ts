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
  finished: boolean;
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
  isMain: boolean;
}

export interface StageRow {
  id: string;
  name: string;
  goal?: string;
  state: "open" | "closed";
  closedAt?: string;
}

export interface StatusData {
  name: string;
  time: string;
  overall: number;
  stagePct: Record<string, number>;
  stages: StageRow[];
  rows: MilestoneRow[];
  tracks: TrackRow[];
  main: string;
  origin: string | null;
  unpushed: number;
  today: number;
  questions: string[];
  nextRow: number | null;
  problems: string[];
  toConfirm?: ToConfirmRow[];
}

export interface ToConfirmRow {
  id: string;
  group: string;
  text: string;
  said: string;
  via: { session: string; track: string; agent: string };
  on?: string;
  disputed?: true;
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

export interface Stroke {
  from: number;
  to: number;
  branch: string | null;
}

export interface DrawnCommit extends Omit<LaidCommit, "top" | "bottom"> {
  branch: string | null;
  top: Stroke[];
  bottom: Stroke[];
}

export interface GraphPage {
  commits: LaidCommit[];
  total: number;
}

export interface GraphView {
  commits: DrawnCommit[];
  main: string;
  colours: ReadonlyMap<string, string>;
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  loadMore: () => void;
  retry: () => void;
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

export interface LiveTicket {
  ticket: string;
  track: string;
  agent: string;
  state: "queued" | "turn";
  since: string;
}

export interface LiveState {
  sessions: LiveSession[];
  claims: LiveClaim[];
  locks: LiveLock[];
  queue?: LiveTicket[];
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
  head?: string;
  dirty?: boolean;
  label?: string;
  scope?: string;
}

export interface EvidenceIndex {
  milestones: { milestone: string; records: EvidenceRecord[] }[];
}

export interface DocumentRow {
  path: string;
  group: string;
  kind: string;
  title: string;
  purpose?: string;
}

export interface DocsIndex {
  documents: DocumentRow[];
  records: string[];
}

export interface Snapshot {
  status: StatusData;
  graph: LaidCommit[];
  graphTotal: number;
  state?: LiveState;
  takenAt: string;
}

export type DeferredState = "unplaced" | "waiting" | "done" | "parked";

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

export interface DonePhase extends StageRow {
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

export interface EndedSession {
  id: string;
  track: string;
  agent: string;
  from: string;
  to: string;
  opened: "recorded" | "first write";
  ended: "closed" | "expired" | "unknown";
  writes: number;
  tasks: string[];
  moreTasks?: number;
}

export interface EndedSessions {
  kept: boolean;
  sessions: EndedSession[];
  total: number;
  earlier?: number;
}

export type Live = "connected" | "reconnecting" | "offline";
export type Page = "board" | "tracks" | "graph" | "done" | "cycles" | "evidence" | "docs";
export type Layout = "landscape" | "portrait";

export interface RepoSummary {
  name: string;
  root: string;
  project: string;
  isDefault: boolean;
  sessions: number;
  locks: number;
  questions: number;
  problems: number;
  overall: number;
  problem?: string;
}

export interface RepoIndex {
  workspace: string;
  repos: RepoSummary[];
  problem?: string;
}

export interface Folder {
  name: string;
  path: string;
  isRepo: boolean;
  hasRecords: boolean;
  listed: string | null;
}

export interface FolderListing {
  dir: string;
  parent: string | null;
  folders: Folder[];
}

export interface RankedTool {
  name: string;
  listed: boolean;
  chars: number;
  calls: number;
  refused: number;
  cut: number;
  invalid: number;
  first: string;
  last: string;
  days: number;
  by: Record<string, number>;
  via: Record<string, number>;
  repos: Record<string, number>;
}

export interface UsageRanking {
  since: string;
  versions: { version: string; since: string }[];
  tools: RankedTool[];
  never: { tools: string[]; chars: number };
}

export interface CurrentCycle {
  n: number;
  since?: string;
  milestones: { open: number; finished: number; carried: number };
  tasks: { landed: number; total: number };
  complete: boolean;
  blockers: string[];
  ask?: string | undefined;
}

export interface ClosedCycle {
  n: number;
  name?: string;
  closedAt: string;
  closedBy: { track: string; agent: string };
  summary: string;
  said?: string;
  from: string;
  to: string;
  milestones: number;
  tasks: number;
}

export interface CycleListing {
  current: CurrentCycle;
  closed: ClosedCycle[];
  matched: number;
}
