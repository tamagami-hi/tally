import { z } from "zod";
import { MOST_FILES, covering } from "@tally/core";
import type { ToolHost } from "../decorate.ts";
import { ok } from "../respond.ts";
import { WHERE, reading, type RepoSource } from "../source.ts";

export function registerCoveringTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "covering",
    {
      description: "What covers some files: the decisions whose paths match them, the context entries in force about them (rules first), and with task its cited records. Give range or paths, not both. `limit` keeps the first files, 200 at most. `unplaced` counts decisions in force with no paths, which no file can match.",
      inputSchema: { paths: z.array(z.string().min(1)).min(1).optional(), range: z.string().min(1).optional(), task: z.string().min(1).optional(), limit: z.number().int().positive().max(MOST_FILES).optional(), ...WHERE },
    },
    ({ paths, range, task, limit, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok(await covering(repo, { paths, range, task, limit }))),
  );
}
