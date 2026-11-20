import type { Entry, KindFile } from "../context/entries.ts";
import type { CycleRecord, CyclesFile } from "../cycles/file.ts";
import type { ClosePlan } from "../cycles/plan.ts";
import type { ActivityEvent, ActivityFile } from "../records/activity.ts";
import type { BuildlogEntry, BuildlogFile } from "../records/buildlog.ts";
import type { Decision, DecisionsFile, Replaced } from "../records/decisions.ts";
import type { EvidenceFile, RunRecord } from "../records/evidence.ts";
import type { Handoff, HandoffNote } from "../records/handoffs.ts";
import type { ManualCheck, ManualFile } from "../records/manual.ts";
import type { Release, ReleasesFile } from "../releases/file.ts";
import type { Note, NotesFile } from "../records/notes.ts";
import type { AnsweredQuestion, Question, QuestionEdit, QuestionsFile } from "../records/questions.ts";
import type { ToolCount, UsageFile } from "../usage/counts.ts";
import type { Deferred, Deliverable, Dropped, Ledger, Milestone, OtherCommit, Parked, Task, WaitOn } from "./ledger.ts";
import type { PhaseRecord, PhasesFile } from "./phases.ts";
import type { Review, ReviewsFile } from "./reviews.ts";
import type { OpenedTrack, TracksFile } from "./tracks.ts";

type Loose<T> = string extends keyof T ? (unknown extends T[string & keyof T] ? true : false) : false;

type Indexed<T> = T extends readonly (infer I)[] ? Indexed<I> : T extends object ? (Loose<T> extends true ? true : true extends { [K in keyof T]-?: Indexed<T[K]> }[keyof T] ? true : false) : false;

export const EXACT_RECORDS: {
  ledger: Indexed<Ledger>; milestone: Indexed<Milestone>; task: Indexed<Task>; deliverable: Indexed<Deliverable>; dropped: Indexed<Dropped>; waitOn: Indexed<WaitOn>; deferred: Indexed<Deferred>; parked: Indexed<Parked>; other: Indexed<OtherCommit>;
  tracks: Indexed<TracksFile>; track: Indexed<OpenedTrack>; phases: Indexed<PhasesFile>; phase: Indexed<PhaseRecord>; reviews: Indexed<ReviewsFile>; review: Indexed<Review>;
  decisions: Indexed<DecisionsFile>; decision: Indexed<Decision>; replaced: Indexed<Replaced>; questions: Indexed<QuestionsFile>; question: Indexed<Question>; questionEdit: Indexed<QuestionEdit>; answered: Indexed<AnsweredQuestion>;
  evidence: Indexed<EvidenceFile>; run: Indexed<RunRecord>; handoff: Indexed<Handoff>; handoffNote: Indexed<HandoffNote>; entries: Indexed<KindFile>; entry: Indexed<Entry>;
  notes: Indexed<NotesFile>; note: Indexed<Note>; buildlog: Indexed<BuildlogFile>; buildlogEntry: Indexed<BuildlogEntry>; activity: Indexed<ActivityFile>; event: Indexed<ActivityEvent>;
  cycles: Indexed<CyclesFile>; cycle: Indexed<CycleRecord>; closing: Indexed<ClosePlan>; usage: Indexed<UsageFile>; toolCount: Indexed<ToolCount>;
  manual: Indexed<ManualFile>; manualCheck: Indexed<ManualCheck>; releases: Indexed<ReleasesFile>; release: Indexed<Release>;
} = {
  ledger: false, milestone: false, task: false, deliverable: false, dropped: false, waitOn: false, deferred: false, parked: false, other: false,
  tracks: false, track: false, phases: false, phase: false, reviews: false, review: false,
  decisions: false, decision: false, replaced: false, questions: false, question: false, questionEdit: false, answered: false,
  evidence: false, run: false, handoff: false, handoffNote: false, entries: false, entry: false,
  notes: false, note: false, buildlog: false, buildlogEntry: false, activity: false, event: false,
  cycles: false, cycle: false, closing: false, usage: false, toolCount: false,
  manual: false, manualCheck: false, releases: false, release: false,
};
