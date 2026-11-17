import { join } from "node:path";
import { TallyError } from "../errors.ts";
import { shortOf, verifyCommit } from "../git/refs.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import type { KeptFile } from "../schema/kept.ts";
import { reviewsFileSchema, type Review, type ReviewState, type ReviewVerdict, type ReviewsFile } from "../schema/reviews.ts";
import { assertMayWrite, isOperator, type Session } from "../state/sessions.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { Records, type Repo } from "../store/records.ts";
import { commitRecords } from "./commit.ts";
import { keptFile, missingFile } from "./kept-file.ts";

export const MOST_REVIEWER = 120;
export const MOST_REVIEW_SUMMARY = 1000;
export const MOST_FINDINGS = 8;

const NO_BLOCKING: readonly ReviewVerdict[] = ["land", "waived"];
const SCRATCH = ".temp";

export interface ReviewInput {
  milestone: string;
  task: string;
  commit: string;
  reviewer: string;
  verdict: ReviewVerdict;
  blocking: number;
  findings?: Record<string, number> | undefined;
  summary: string;
  follows?: string | undefined;
  report?: string | undefined;
}

export interface ReviewRecorded {
  review: Review;
  state: ReviewState;
  commit: string | null;
}

export interface TaskReviews {
  state: ReviewState;
  latest?: Review;
}

export const reviewsPath = (repo: Repo): string => join(repo.recordsDir, "reviews.json");

export async function readReviews(repo: Repo): Promise<ReviewsFile> {
  try {
    return await readJson(reviewsPath(repo), reviewsFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, nextId: 1, reviews: [] };
    throw error;
  }
}

export const reviewsOf = (reviews: readonly Review[], milestone: string, task: string): Review[] => reviews.filter((review) => review.milestone === milestone && review.task === task);

export function reviewStateOf(reviews: readonly Review[], milestone: string, task: string): TaskReviews {
  const latest = reviewsOf(reviews, milestone, task).at(-1);
  if (latest === undefined) return { state: "none" };
  return { state: NO_BLOCKING.includes(latest.verdict) ? "clear" : "open", latest };
}

const findings = (count: number): string => `${count} blocking finding${count === 1 ? "" : "s"}`;

function assertShort(text: string, most: number, what: string): void {
  if (text.length > most) throw new TallyError(`a review's ${what} holds at most ${most} characters; this one has ${text.length}`);
}

function assertFits(input: ReviewInput): void {
  assertShort(input.reviewer, MOST_REVIEWER, "reviewer");
  assertShort(input.summary, MOST_REVIEW_SUMMARY, "summary");
  const counts = Object.keys(input.findings ?? {}).length;
  if (counts > MOST_FINDINGS) throw new TallyError(`a review's findings hold at most ${MOST_FINDINGS} counts; these have ${counts}`);
  const blocks = input.blocking > 0;
  if (blocks === NO_BLOCKING.includes(input.verdict)) throw new TallyError(`a review with the verdict ${input.verdict} has ${findings(input.blocking)}; land and waived take 0, fix and stop take 1 or more`);
}

function assertWaiver(repo: Repo, session: Session, input: ReviewInput): void {
  if (input.verdict !== "waived") return;
  if (!isOperator(repo, session)) throw new TallyError("only an operator session records a waiver; ask with question_add");
  if (input.follows !== undefined) throw new TallyError("a waiver follows no review; record it without follows");
}

export async function reviewsWhenRequired(repo: Repo): Promise<Review[]> {
  return repo.config.reviews?.required === true ? (await readReviews(repo)).reviews : [];
}

function assertFollows(reviews: readonly Review[], input: ReviewInput): void {
  if (input.follows === undefined) return;
  const own = reviewsOf(reviews, input.milestone, input.task);
  if (own.some((review) => review.id === input.follows && review.verdict === "waived")) throw new TallyError(`${input.follows} is a waiver, and a waiver is not followed up; record the review without follows`);
  if (own.some((review) => review.id === input.follows && review.verdict !== "waived")) return;
  const named = own.filter((review) => review.verdict !== "waived").map((review) => review.id).join(", ");
  throw new TallyError(`${input.follows} is not a review of ${input.milestone} '${input.task}'; its reviews: ${named === "" ? "none yet" : named}`);
}

async function shortCommit(session: Session, commit: string): Promise<string> {
  const full = await verifyCommit(session.worktree, commit);
  if (full === null) throw new TallyError(`${commit}: no such commit in the repository; give the commit the reviewer read`);
  return shortOf(session.worktree, full);
}

async function reportOf(repo: Repo, session: Session, report: string | undefined): Promise<KeptFile | undefined> {
  if (report === undefined) return undefined;
  const outside = (given: string): string => `the report must be inside the session's worktree or the repository's ${SCRATCH}/: ${given}`;
  const scratch = join(repo.root, SCRATCH);
  return (await keptFile(report, { base: session.worktree, folders: [session.worktree, scratch], outside, missing: missingFile("the report", session.worktree, scratch) })).file;
}

const told = (review: Review): string => `${review.id}: ${review.milestone} '${review.task}' ${review.verdict}${review.blocking === 0 ? "" : `, ${review.blocking} blocking`}`;

export async function recordReview(repo: Repo, session: Session, input: ReviewInput, now = new Date()): Promise<ReviewRecorded> {
  const task = findTask(findMilestone(await new Records(repo).readLedger(), input.milestone), input.task);
  if (task === undefined) throw new TallyError(`'${input.task}' is not planned in ${input.milestone}`);
  assertMayWrite(repo, session, task.track);
  assertFits(input);
  assertWaiver(repo, session, input);
  const commit = await shortCommit(session, input.commit);
  const report = await reportOf(repo, session, input.report);
  const path = reviewsPath(repo);
  const { review, reviews } = await withLock(path, async () => {
    const file = await readReviews(repo);
    assertFollows(file.reviews, input);
    const made: Review = {
      id: `review-${file.nextId}`, milestone: input.milestone, task: input.task, track: task.track, commit, reviewer: input.reviewer, verdict: input.verdict, blocking: input.blocking,
      ...(input.findings === undefined ? {} : { findings: { ...input.findings } }), summary: input.summary, ...(input.follows === undefined ? {} : { follows: input.follows }),
      ...(report === undefined ? {} : { report }), by: { track: session.track, agent: session.agent }, at: now.toISOString(),
    };
    const next = { ...file, nextId: file.nextId + 1, reviews: [...file.reviews, made] };
    await writeJsonAtomic(path, reviewsFileSchema.parse(next));
    return { review: made, reviews: next.reviews };
  });
  return { review, state: reviewStateOf(reviews, input.milestone, input.task).state, commit: await commitRecords(repo, told(review)) };
}
