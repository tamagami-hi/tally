import { z } from "zod";
import { closeTrack, listTracks, openTrack } from "@tally/core";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

export function registerTrackTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "track_open",
    {
      description: "Open a new track: tally makes the branch track/<name> at main's tip and a worktree for it, writes the runner there, and records who opened it and why. The answer carries the absolute `worktree`: start the helper there and have it call session_open with that folder; `scratch` is the helper's own folder for notes and throwaway files. An operator session opens any track; a track's session opens only a child of its own track, and may then write that child's tasks, evidence and hand-offs. Every track, child or not, lands on main through land_start.",
      inputSchema: {
        sessionId: z.string(),
        name: z.string().describe("lowercase letters, digits, - and _; it names the branch track/<name> and the worktree's folder"),
        purpose: z.string().describe("one line on what the track is for; track_list shows it"),
        parent: z.string().optional().describe("the track this one helps; a track's session leaves it out or names its own track"),
        paths: z.array(z.string()).optional().describe("the only folders or files, relative to the worktree, this track may land; left out, it may land any"),
      },
    },
    ({ sessionId, name, purpose, parent, paths }) => inSession(source, sessionId, async (repo, session) => {
      const { track, runner, scratch, commit } = await openTrack(repo, session, { name, purpose, ...(parent === undefined ? {} : { parent }), ...(paths === undefined ? {} : { paths }) });
      return ok({ ...track, runner, scratch, commit });
    }),
  );
  server.registerTool(
    "track_close",
    {
      description: "Close a track that track_open made: tally removes its landing checkout, its worktree and its branch, and marks the record closed. For an operator session or a session of the track's parent. Refused, with nothing removed, while the track has an open session, a claimed task, uncommitted work, commits that are not on main, or ignored files in its worktree that tally did not write; the refusal names them. Run logs are kept: they are outside the worktree.",
      inputSchema: { sessionId: z.string(), name: z.string().describe("the track's name, as track_list shows it") },
    },
    ({ sessionId, name }) => inSession(source, sessionId, async (repo, session) => {
      const { track, commit } = await closeTrack(repo, session, name);
      return ok({ ...track, commit });
    }),
  );
  server.registerTool(
    "track_list",
    { description: "Every track of one repository: its name, branch, worktree and parent, its purpose when an agent opened it, the `paths` it may land when it is limited to some, whether it comes from the config or was opened with track_open (`source`), and whether a session is open on it (`hasSession`).", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok({ tracks: await listTracks(repo) })),
  );
}
