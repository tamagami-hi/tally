import { z } from "zod";
import { TallyError, appendBuildlog, checksFileSchema, checksFingerprint, readBuildlog, readChecks, renderBuildlog, setChecks, verifiedSchema } from "@tally/core";
import { defined } from "../defined.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

export function registerCheckTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "checks_get",
    { description: "The code-check record: the fingerprint it was verified at, every check's result, the suites and each module's files, tests, entry points and gaps.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const record = await readChecks(repo);
      if (record === null) throw new TallyError("no checks.json yet; import one with tally import checks");
      return ok(record);
    }),
  );
  server.registerTool(
    "checks_fingerprint",
    { description: "Whether the code-check record stands: its fingerprint against what git log prints for the config's code paths at main.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok(await checksFingerprint(repo))),
  );
  server.registerTool(
    "checks_set",
    { description: "Replace the code-check record whole with measured results; refused unless its fingerprint is what git log prints for the config's code paths at main.", inputSchema: { sessionId: z.string(), record: checksFileSchema } },
    ({ sessionId, record }) => inSession(source, sessionId, async (repo) => {
      return ok(await setChecks(repo, record));
    }),
  );
  server.registerTool(
    "buildlog_append",
    {
      description: "Add a dated section to a group's build log: what was built, verified, decided and corrected; one section per milestone and group. Give it as fields (`built`, `verified`, `decided`, `corrected`, `open`), as Markdown (`markdown`), or both.",
      inputSchema: {
        sessionId: z.string(),
        group: z.string(),
        milestone: z.string(),
        title: z.string(),
        date: z.string(),
        markdown: z.string().optional(),
        commits: z.array(z.string()).optional(),
        built: z.string().optional().describe("what was built, in a sentence or two"),
        verified: z.array(verifiedSchema).optional().describe("each thing verified: what, the check, and its totals such as {passed: 101, failed: 0}"),
        decided: z.array(z.string()).optional(),
        corrected: z.array(z.string()).optional(),
        open: z.array(z.string()).optional().describe("what is left open"),
      },
    },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo) => ok(await appendBuildlog(repo, defined(input)))),
  );
  server.registerTool(
    "buildlog_render",
    { description: "A group's build log as the Markdown a reader would have read in build-log.md; a section that was given as fields is rendered from them.", inputSchema: { group: z.string(), ...WHERE } },
    ({ group, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const text = renderBuildlog(await readBuildlog(repo), group);
      return ok({ group, markdown: text }, text);
    }),
  );
}
