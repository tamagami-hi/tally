import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { keepsContextAsRecords, listSessions, logActivity, messageOf, sessionSchema, type Repo, type Session } from "@tally/core";
import type { Called, Decorator } from "../decorate.ts";

interface Actor {
  repo: Repo;
  session: Pick<Session, "id" | "track" | "agent">;
}

const READ_ENDINGS = ["_list", "_get", "_read", "_search", "_wait", "_check", "_fingerprint", "_pack", "_render"] as const;
const WRITES_WITH_A_READ_ENDING: ReadonlySet<string> = new Set(["task_wait"]);
const NAMING = ["name", "ticket", "id", "kind"] as const;
const MOST_TARGET = 120;

const worded = (value: unknown): string[] => (typeof value === "string" && value !== "" ? [value] : []);

export const isRead = (tool: string): boolean => !WRITES_WITH_A_READ_ENDING.has(tool) && READ_ENDINGS.some((ending) => tool.endsWith(ending));

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
  const { tool, args, result } = called;
  const sessionId = args["sessionId"];
  if (typeof sessionId !== "string" || result.isError === true || isRead(tool)) return result;
  const actor = await actorOf(called, sessionId).catch(withoutActor);
  if (actor === undefined) return result;
  const target = targetOf(args);
  try {
    await logActivity(actor.repo, { session: actor.session.id, track: actor.session.track, agent: actor.session.agent, verb: tool, ...(target === undefined ? {} : { target }) });
    return result;
  } catch (error: unknown) {
    return withProblem(result, messageOf(error));
  }
};
