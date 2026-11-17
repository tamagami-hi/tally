import { z } from "zod";
import { MOST_REVIEWER, MOST_REVIEW_SUMMARY, Records, TallyError, needingReview, reviewSchema, readReviews, recordReview, reviewStateOf, reviewVerdicts, type Needing, type Review, type ReviewState } from "@tally/core";
import { FIELDS, pick } from "../filters.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const DEFAULT_REVIEWS = 20;
const MOST_REVIEWS = 200;
const MOST_NAMED = 20;
const MOST_FINDING_NAME = 40;
const MOST_BLOCKING = 999;
const REVIEW_KEYS: readonly string[] = Object.keys(reviewSchema.shape);

const named = (one: Needing): string => `${one.milestone} '${one.task}' (${one.latest === undefined ? "no review" : `${one.latest.id} open, ${one.latest.blocking} blocking`})`;

function statesOf(reviews: readonly Review[]): Map<string, ReviewState> {
  const keys = new Set(reviews.map((review) => `${review.milestone}\0${review.task}`));
  return new Map([...keys].map((key) => {
    const [milestone = "", task = ""] = key.split("\0");
    return [key, reviewStateOf(reviews, milestone, task).state];
  }));
}

export function registerReviewTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "review_record",
    {
      description: "Record a review of a task's work: the commit the reviewer read, who reviewed (not the builder), the verdict (land: nothing blocks; fix: land once the blocking findings are fixed; stop: not as built; waived: needs none, an operator session's) and how many findings block. Answers the review and the task's state after it (none, open or clear); a refusal says what each verdict takes.",
      inputSchema: {
        sessionId: z.string(), milestone: z.string(), task: z.string(), commit: z.string(), reviewer: z.string().min(1).max(MOST_REVIEWER), verdict: z.enum(reviewVerdicts),
        blocking: z.number().int().min(0).max(MOST_BLOCKING), findings: z.record(z.string().min(1).max(MOST_FINDING_NAME), z.number().int().nonnegative()).optional(), summary: z.string().min(1).max(MOST_REVIEW_SUMMARY), follows: z.string().optional(), report: z.string().optional(),
      },
    },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await recordReview(repo, session, input))),
  );
  server.registerTool(
    "review_list",
    {
      description: "Reviews, newest first: 20 unless `limit` says, with `matched`. Filters: milestone, task, track, and `state`, the reviewed task's (open: its newest review has blocking findings). Where reviews are required, `needing` names up to 20 landed tasks without a clear review, and the total.",
      inputSchema: { milestone: z.string().optional(), task: z.string().optional(), track: z.string().optional(), state: z.enum(["open", "clear"]).optional(), limit: z.number().int().positive().max(MOST_REVIEWS).optional(), fields: FIELDS, ...WHERE },
    },
    ({ milestone, task, track, state, limit, fields, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const unknown = (fields ?? []).filter((key) => !REVIEW_KEYS.includes(key));
      if (unknown.length > 0) throw new TallyError(`a review has no '${unknown.join("', '")}'; its keys: ${REVIEW_KEYS.join(", ")}`);
      const { reviews } = await readReviews(repo);
      const fits = (one: { milestone: string; task: string; track: string }): boolean => (milestone === undefined || one.milestone === milestone) && (task === undefined || one.task === task) && (track === undefined || one.track === track);
      const states = statesOf(reviews);
      const found = reviews.filter(fits).filter((one) => state === undefined || states.get(`${one.milestone}\0${one.task}`) === state);
      const newest = [...found].reverse().slice(0, limit ?? DEFAULT_REVIEWS).map((one) => pick({ ...one }, fields));
      const setting = repo.config.reviews;
      const needing = setting?.required === true ? needingReview(await new Records(repo).readLedger(), reviews, setting).filter(fits) : undefined;
      return ok({ reviews: newest, matched: found.length, ...(needing === undefined ? {} : { needing: { tasks: needing.slice(0, MOST_NAMED).map(named), total: needing.length } }) });
    }),
  );
}
