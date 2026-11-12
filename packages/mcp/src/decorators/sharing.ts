import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { collectInbox, listSessions, overlapsOf, type InboxItem, type OverlapWith } from "@tally/core";
import type { Decorator } from "../decorate.ts";

const WARNED = new Set(["session_open", "task_claim", "land_start"]);
const QUIET = new Set(["inbox_get"]);

function sessionOf(tool: string, args: Record<string, unknown>, result: CallToolResult): string | undefined {
  const given = args["sessionId"];
  if (typeof given === "string") return given;
  const opened = tool === "session_open" ? result.structuredContent?.["id"] : undefined;
  return typeof opened === "string" ? opened : undefined;
}

const inboxText = (items: readonly InboxItem[]): string => `inbox:\n${items.map((item) => `- ${item.text}`).join("\n")}`;

const overlapText = (found: readonly OverlapWith[]): string => `overlaps:\n${found.map((overlap) => `- ${overlap.file} is also changed by ${overlap.with.join(", ")}`).join("\n")}`;

export const sharing: Decorator = async ({ tool, args, result, source }) => {
  if (result.isError === true || QUIET.has(tool)) return result;
  const id = sessionOf(tool, args, result);
  if (id === undefined) return result;
  try {
    const repo = await source.forSession(id);
    const session = (await listSessions(repo)).find((open) => open.id === id);
    if (session === undefined) return result;
    const found = WARNED.has(tool) ? await overlapsOf(repo, session.track) : [];
    const items = await collectInbox(repo, session);
    if (found.length === 0 && items.length === 0) return result;
    const extra = { ...(found.length === 0 ? {} : { overlaps: found }), ...(items.length === 0 ? {} : { inbox: items }) };
    const lines = [...(found.length === 0 ? [] : [overlapText(found)]), ...(items.length === 0 ? [] : [inboxText(items)])];
    return { ...result, content: [...result.content, { type: "text", text: lines.join("\n") }], structuredContent: { ...result.structuredContent, ...extra } };
  } catch {
    return result;
  }
};
