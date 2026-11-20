import { z } from "zod";
import { endTrial, startTrial } from "@tally/core";
import { ok } from "../respond.ts";
import { inSession, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const TRIAL_START = "An operator session's, to check lanes together before any lands: branch trial/<name> at main's tip, a checkout under .temp/tally/trials/<name>, and each track's commits ahead of main picked onto it in the order given. A conflict leaves nothing and is named. Its `runner` needs --task; runs are recorded with `trial`. A trial lands nothing.";

const TRIAL_END = "An operator session's: remove a trial's checkout and branch; run logs are kept. Refused, naming them, while the checkout holds uncommitted work or the branch has commits beyond the picks.";

export function registerTrialTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "trial_start",
    { description: TRIAL_START, inputSchema: { sessionId: z.string(), name: z.string(), tracks: z.array(z.string()).min(1) } },
    ({ sessionId, name, tracks }) => inSession(source, sessionId, async (repo, session) => ok(await startTrial(repo, session, { name, tracks }))),
  );
  server.registerTool(
    "trial_end",
    { description: TRIAL_END, inputSchema: { sessionId: z.string(), name: z.string() } },
    ({ sessionId, name }) => inSession(source, sessionId, async (repo, session) => ok(await endTrial(repo, session, name))),
  );
}
