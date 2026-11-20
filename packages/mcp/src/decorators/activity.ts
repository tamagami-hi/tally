import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { flushWhenFree, keepsContextAsRecords, listSessions, logActivity, messageOf, sessionSchema, type Repo, type Session } from "@tally/core";
import type { Called, Decorator } from "../decorate.ts";
import { writesNothing } from "../meta.ts";
import { sessionOf } from "./session-of.ts";

interface Actor {
  repo: Repo;
  session: Pick<Session, "id" | "track" | "agent">;
}

const NAMING = ["name", "ticket", "id", "kind"] as const;
const MOST_TARGET = 120;

const worded = (value: unknown): string[] => (typeof value === "string" && value !== "" ? [value] : []);

const COMMITS_THE_RECORDS: ReadonlySet<string> = new Set(["phase_close", "records_commit"]);

export const isUnlogged = (tool: string): boolean => writesNothing(tool) || COMMITS_THE_RECORDS.has(tool);

interface Logged {
  verb: string;
  target?: string;
}

const decisionOf = (result: CallToolResult): { id?: unknown; group?: unknown; state?: unknown } => (result.structuredContent?.["decision"] ?? {}) as { id?: unknown; group?: unknown; state?: unknown };

const LOGGED_AS: Readonly<Record<string, (args: Record<string, unknown>, result: CallToolResult) => Logged>> = {
  decision_record: (_args, result) => ({ verb: result.structuredContent?.["replaced"] === undefined ? "decision_add" : "decision_replace", target: `${String(decisionOf(result).group)} / ${String(decisionOf(result).id)}` }),
  decision_status: (_args, result) => ({ verb: "decision_status", target: `${String(decisionOf(result).group)} / ${String(decisionOf(result).id)}: ${String(decisionOf(result).state)}` }),
  question_answer: (args) => ({ verb: "question_answer", target: `${String(args["id"])}: ${String(args["decision"])}` }),
};

function loggedAs(tool: string, args: Record<string, unknown>, result: CallToolResult): Logged {
  const special = LOGGED_AS[tool];
  if (special !== undefined) return special(args, result);
  const target = targetOf(args);
  return { verb: tool, ...(target === undefined ? {} : { target }) };
}

export function targetOf(args: Record<string, unknown>): string | undefined {
  const task = [...worded(args["milestone"]), ...worded(args["task"])].join(" / ");
  const parts = [...worded(task), ...NAMING.flatMap((key) => worded(args[key]))];
  return parts.length === 0 ? undefined : parts.join(", ").slice(0, MOST_TARGET);
}

function closedBy(result: CallToolResult, sessionId: string): Session | undefined {
  const closed = sessionSchema.safeParse(result.structuredContent?.["session"]);
  return closed.success && closed.data.id === sessionId ? closed.data : undefined;
}

async function actorOf({ result, source }: Called, sessionId: string): Promise<Actor | undefined> {
  const closed = closedBy(result, sessionId);
  const repo = closed === undefined ? await source.forSession(sessionId) : (await source.forWorktree(closed.worktree)).repo;
  if (!keepsContextAsRecords(repo.config)) return undefined;
  const session = closed ?? (await listSessions(repo)).find((open) => open.id === sessionId);
  return session === undefined ? undefined : { repo, session };
}

const withoutActor = (): undefined => undefined;

function withProblem(result: CallToolResult, problem: string): CallToolResult {
  return {
    ...result,
    content: [...result.content, { type: "text", text: `the activity log was not written: ${problem}` }],
    structuredContent: { ...result.structuredContent, activityProblem: problem },
  };
}

export const activity: Decorator = async (called) => {
  const { tool, args, result, place } = called;
  const sessionId = sessionOf(tool, args, result);
  if (sessionId === undefined || result.isError === true || isUnlogged(tool) || writesNothing(tool, place)) return result;
  const actor = await actorOf(called, sessionId).catch(withoutActor);
  if (actor === undefined) return result;
  const logged = loggedAs(tool, args, result);
  try {
    await logActivity(actor.repo, { session: actor.session.id, track: actor.session.track, agent: actor.session.agent, ...logged });
    if ((await listSessions(actor.repo)).length === 0) await flushWhenFree(actor.repo);
    return result;
  } catch (error: unknown) {
    return withProblem(result, messageOf(error));
  }
};
