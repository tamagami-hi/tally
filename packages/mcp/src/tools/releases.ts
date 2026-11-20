import { z } from "zod";
import { listReleases, markRelease } from "@tally/core";
import { defined } from "../defined.ts";
import { LIMIT } from "../filters.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const RELEASE_MARK = "Record a release, an operator session's: `version` at `commit`, main's tip unless given, which must be on main and at or after the latest release's commit. A version is recorded once.";

const RELEASE_LIST = "The releases, newest first, 10 unless `limit` says, with `matched`. Each answers its tasks, computed from the ledgers: those landed on main after the release before it and at or before its commit, by milestone; and `whatsNew`, where the config has releases.notes, whether that file is in its commit. `unreleased`: the tasks landed after the last.";

export function registerReleaseTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "release_mark",
    { description: RELEASE_MARK, inputSchema: { sessionId: z.string(), version: z.string(), commit: z.string().optional(), notes: z.string().optional() } },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await markRelease(repo, session, defined(input)))),
  );
  server.registerTool(
    "release_list",
    { description: RELEASE_LIST, inputSchema: { version: z.string().optional(), limit: LIMIT, ...WHERE } },
    ({ version, limit, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok(await listReleases(repo, { version, limit }))),
  );
}
