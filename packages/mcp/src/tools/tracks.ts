import { z } from "zod";
import { closeTrack, listTracks, openTrackWithPlan } from "@tally/core";
import { plannedTasks } from "../planned-task.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

export function registerTrackTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "track_open",
    {
      description: "Open a track: tally makes the branch track/<name> at main's tip and its worktree, writes the runner there and records who opened it and why. The helper opens its session in the answer's `worktree`; `scratch` is its notes folder. An operator session opens any track; a track's session only a child of its own, whose tasks, evidence and hand-offs it may write. `plan` plans its tasks too (`planned`): refused before anything is done if it cannot be made; if it fails after, the track stays open with `planProblem`. Every track lands via land_start.",
      inputSchema: {
        sessionId: z.string(),
        name: z.string().describe("lowercase letters, digits, - and _; it names the branch track/<name> and the worktree's folder"),
        purpose: z.string().describe("one line on what the track is for; track_list shows it"),
        parent: z.string().optional().describe("the track this one helps; a track's session leaves it out or names its own track"),
        paths: z.array(z.string()).optional().describe("the only folders or files it may land, from the worktree; left out, any"),
        plan: z.strictObject({ milestone: z.string(), tasks: plannedTasks }).optional().describe("tasks to plan on the new track at once, as task_plan takes them"),
      },
    },
    ({ sessionId, name, purpose, parent, paths, plan }) => inSession(source, sessionId, async (repo, session) => {
      const input = { name, purpose, ...(parent === undefined ? {} : { parent }), ...(paths === undefined ? {} : { paths }) };
      const { track, runner, scratch, commit, ...planned } = await openTrackWithPlan(repo, session, input, plan);
      return ok({ ...track, runner, scratch, commit, ...planned });
    }),
  );
  server.registerTool(
    "track_close",
    {
      description: "Close a track that track_open made (an operator session, or one of its parent): tally removes its landing checkout, worktree and branch and marks it closed. Build output in the worktree goes with it (`cleaned`); what the agent kept under .temp/ moves to the repository's .temp/closed/<track>/ (`kept`). Refused, removing nothing, while the track has an open session, an open child, a claimed task, a queued landing, uncommitted work or commits not on main; the refusal names them. Run logs are kept.",
      inputSchema: { sessionId: z.string(), name: z.string().describe("the track's name, as track_list shows it") },
    },
    ({ sessionId, name }) => inSession(source, sessionId, async (repo, session) => {
      const { track, commit, cleaned, kept } = await closeTrack(repo, session, name);
      return ok({ ...track, cleaned, ...(kept === undefined ? {} : { kept }), commit });
    }),
  );
  server.registerTool(
    "track_list",
    { description: "Every track of one repository: its name, branch, worktree and parent, its purpose when an agent opened it, the `paths` it may land if limited, whether it is the config's or opened with track_open (`source`), and whether a session is open on it (`hasSession`).", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok({ tracks: await listTracks(repo) })),
  );
}
