import type { CallToolResult } from "./respond.ts";
import { getSession, isOperator, sessionSchema, type Outcome, type Scope, type Usage } from "@tally/core";
import { sessionOf } from "./decorators/session-of.ts";
import { wasCut } from "./decorators/sized.ts";
import type { RepoSource } from "./source.ts";

export interface CallSeen {
  tool: string;
  args: Record<string, unknown>;
  result: CallToolResult;
  source: RepoSource;
  invalid?: boolean;
  via?: string;
}

interface Placed {
  by: Scope;
  repo?: string;
}

const outcomeOf = ({ result, invalid }: CallSeen): Outcome => {
  if (invalid === true) return "invalid";
  if (result.isError === true) return "refused";
  return wasCut(result) ? "cut" : "answered";
};

const named = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

async function placeOfSession(source: RepoSource, sessionId: string, result: CallToolResult): Promise<Placed> {
  const repo = await source.forSession(sessionId);
  const closed = sessionSchema.safeParse(result.structuredContent?.["session"]);
  const session = closed.success && closed.data.id === sessionId ? closed.data : await getSession(repo, sessionId);
  return { by: isOperator(repo, session) ? "operator" : "track", repo: repo.name };
}

async function placeOf(call: CallSeen): Promise<Placed> {
  const sessionId = sessionOf(call.tool, call.args, call.result);
  if (sessionId !== undefined) return placeOfSession(call.source, sessionId, call.result).catch(() => ({ by: "none" }));
  const repo = await call.source.forRead({ repo: named(call.args["repo"]) }).catch(() => undefined);
  return { by: "none", ...(repo === undefined ? {} : { repo: repo.name }) };
}

export async function countCall(usage: Usage | undefined, call: CallSeen): Promise<void> {
  if (usage === undefined) return;
  try {
    const placed = await placeOf(call);
    usage.count({ tool: call.tool, outcome: outcomeOf(call), ...placed, ...(call.via === undefined ? {} : { via: call.via }) });
  } catch {
    return;
  }
}
