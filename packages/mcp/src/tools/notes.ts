import { z } from "zod";
import { MAX_NOTE, doneNote, listNotes, noteKinds, peekInbox, postNote, replyNote } from "@tally/core";
import type { ToolHost } from "../decorate.ts";
import { ok } from "../respond.ts";
import { inSession, type RepoSource } from "../source.ts";

export function registerNoteTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "note_post",
    {
      description: `Leave a note for the agents on other tracks of this repository: a heads-up about something you changed, a request, an answer, or a finding. It reaches each track it is for in that track's next tool answer, under \`inbox\`. At most ${MAX_NOTE} characters.`,
      inputSchema: { sessionId: z.string(), to: z.union([z.literal("all"), z.array(z.string()).min(1)]).describe("\"all\", or the tracks it is for; the main branch's name reaches the operator's session"), kind: z.enum(noteKinds), text: z.string(), paths: z.array(z.string()).optional().describe("the files it is about"), task: z.string().optional().describe("the task it is about, as MILESTONE:TASK") },
    },
    ({ sessionId, to, kind, text, paths, task }) => inSession(source, sessionId, async (repo, session) => {
      const about = paths === undefined && task === undefined ? undefined : { ...(paths === undefined ? {} : { paths }), ...(task === undefined ? {} : { task }) };
      return ok(await postNote(repo, session, { to, kind, text, ...(about === undefined ? {} : { about }) }));
    }),
  );
  server.registerTool(
    "note_reply",
    { description: "Reply to a note. The reply reaches the note's writer and the tracks it was for.", inputSchema: { sessionId: z.string(), id: z.string(), text: z.string() } },
    ({ sessionId, id, text }) => inSession(source, sessionId, async (repo, session) => ok(await replyNote(repo, session, id, text))),
  );
  server.registerTool(
    "note_done",
    { description: "Mark a note as done, so it leaves the open list. Its writer, a track it was for, or an operator session may.", inputSchema: { sessionId: z.string(), id: z.string() } },
    ({ sessionId, id }) => inSession(source, sessionId, async (repo, session) => ok(await doneNote(repo, session, id))),
  );
  server.registerTool(
    "note_list",
    { description: "The notes for the session's track: the open ones by default.", inputSchema: { sessionId: z.string(), state: z.enum(["open", "done", "all"]).default("open"), since: z.string().optional().describe("an ISO time: only notes written, replied to or closed since then"), limit: z.number().int().positive().optional(), everyTrack: z.boolean().default(false).describe("list the notes of every track, not only this session's") } },
    ({ sessionId, state, since, limit, everyTrack }) => inSession(source, sessionId, async (repo, session) =>
      ok({ notes: await listNotes(repo, { state, ...(everyTrack ? {} : { track: session.track }), ...(since === undefined ? {} : { since }), ...(limit === undefined ? {} : { limit }) }) })),
  );
  server.registerTool(
    "inbox_get",
    { description: "Read the session's inbox again, without taking anything: notes and replies, the operator's answers, commits on main that changed a file this track changed, the landing queue, and runs taken in or set aside. Every other tool's answer already carries what is new, once, under `inbox`; call this when an answer may not have reached you.", inputSchema: { sessionId: z.string(), since: z.string().optional().describe("an ISO time; the session's opening when left out") } },
    ({ sessionId, since }) => inSession(source, sessionId, async (repo, session) => ok({ items: await peekInbox(repo, session, since) })),
  );
}
